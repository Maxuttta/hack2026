(() => {
  const desktop = window.blueprintsDesktop;
  const editor = document.querySelector('.editor-area');
  editor.classList.add('has-features');
  const originalShowFile = showFile;
  showFile = function (name) {
    flushTypingHistory();
    originalShowFile(name);
    document.getElementById('codeFile').textContent = name.replaceAll('\\', '/').split('/').at(-1);
    historyState = captureHistory();
    scheduleAstGraph();
  };
  document.getElementById('codeFile').textContent = active;
  Object.assign(iconPaths, {
    save: '<path d="M4 3h14l3 3v15H3V3zM7 3v7h10V3M7 21v-8h10v8"/>',
    export: '<path d="M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7"/>',
    sparkle: '<path d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2Z"/>',
    build: '<path d="m4 20 7-7m3-10 7 7-4 4-7-7 4-4ZM3 17l4 4"/>',
    snapshot: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>'
  });

  const toolbar = document.createElement('div');
  toolbar.className = 'workspace-toolbar';
  toolbar.innerHTML = `
    <button data-command="open" title="Открыть папку с Java-проектом">${iconSvg('folderOpen', 15)} Открыть</button>
    <button data-command="load-demo" title="Open the reproducible 1,000-line Java case">${iconSvg('fileCode', 15)} Case demo</button>
    <button data-command="save" title="Сохранить Java-файлы в папку проекта">${iconSvg('save', 15)} Сохранить</button>
    <button data-command="export" title="Экспортировать Java-файлы">${iconSvg('export', 15)} Экспорт</button>
    <span class="separator"></span>
    <button data-command="analyze" title="Анализировать код и проверить сборку">${iconSvg('search', 15)} Анализ</button>
    <button data-command="optimize-example" title="Показать декомпозицию и устранение вложенного поиска на демонстрационном примере">${iconSvg('sparkle', 15)} Улучшить пример</button>
    <button data-command="extract-method" title="Перенести самостоятельный статический метод в отдельный класс с проверкой компиляции и поведения">${iconSvg('sparkle', 15)} Извлечь метод</button>
    <button data-command="compile" title="Скомпилировать весь проект">${iconSvg('build', 15)} Сборка</button>
    <button class="primary" data-command="run" title="Собрать и запустить главный класс">${iconSvg('play', 15)} Запуск</button>
    <span class="separator"></span>
    <button data-command="baseline" title="Запомнить текущую версию перед изменениями">${iconSvg('snapshot', 15)} Исходная версия</button>
    <button data-command="compare" title="Сравнить вывод исходной и текущей версий">${iconSvg('circleCheck', 15)} Проверить поведение</button>
    <button data-command="probe" title="Найти вход, на котором исходная и текущая версии ведут себя по-разному">${iconSvg('search', 15)} Контрпример</button>
    <button data-command="autocheck" class="enabled" title="Автоматически проверять поведение после изменений">${iconSvg('circleCheck', 15)} <span id="autocheckLabel">Автопроверка</span></button>
    <span class="ast-status" id="astStatus" title="Покрытие схемы синтаксическим деревом Java"></span>
    <span class="workspace-name" id="workspaceName">Локальный пример</span>`;
  editor.prepend(toolbar);

  const dock = document.createElement('section');
  dock.className = 'bottom-dock';
  dock.innerHTML = `<div class="dock-tabs">
    <button data-dock="analysis">Анализ <span id="problemCount"></span></button>
    <button data-dock="structure">Структура</button>
    <button data-dock="console">Консоль</button>
    <button data-dock="tests">Проверка поведения</button>
    <button class="close-dock" title="Скрыть панель">×</button>
  </div><div class="dock-content" id="dockContent"></div>`;
  editor.appendChild(dock);
  const dockContent = dock.querySelector('#dockContent');
  const testState = { inputs: [
    '', 'alpha\n', 'alpha\nbeta\nalpha\n',
    ' alpha \n\n beta \nalpha\n', 'a\nA\na\n',
    'кириллица\n日本語\nкириллица\n',
    'sku001: Red\nsku001:red\n', 'sku139: Blue\nsku139:blue\n'
  ], stdin: '', mainClass: '' };
  let currentDock = 'analysis';
  let findings = [];
  let outline = [];
  let refactors = [];
  let compileDiagnostics = [];
  let consoleText = 'The build has not run yet.';
  let consoleError = false;
  let compareResult = null;
  let probeResult = null;
  let baseline = null;
  let projectName = 'Java Blueprints';
  let busy = false;
  let saveTimer = null;
  let autoTimer = null;
  let autoVersion = 0;
  let checking = false;
  let autoCheck = true;
  const collapsedFolders = new Set();
  let astGraphCache = null;
  let astGraphTimer = null;
  let astGraphVersion = 0;
  const astKind = {
    variable: ['Переменная', 'type'], expression: ['Операция', 'fn'], return: ['Возврат', 'kw'],
    throw: ['Исключение', 'kw'], break: ['break', 'kw'], continue: ['continue', 'kw'],
    assert: ['assert', 'kw'], loop: ['Цикл', 'kw'], if: ['Условие', 'kw'],
    switch: ['switch', 'kw'], try: ['try / catch', 'kw']
  };

  const originalParseSource = parseSource;
  parseSource = function (source) {
    const nodes = originalParseSource(source);
    if (!astGraphCache || astGraphCache.file !== active || astGraphCache.source !== source) return nodes;
    const lineStarts = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
    const covers = (entry, line) => nodes.some(node => {
      if (node.start === line) return true;
      return (node.type === 'ifChain' || node.fieldType === 'switch') && node.start < line && node.end >= line;
    });
    const collapsedAstRanges = [];
    for (const entry of astGraphCache.entries) {
      if (!Number.isInteger(entry.start) || !Number.isInteger(entry.end) || entry.start < 0 || entry.end > source.length) continue;
      const line = entry.line - 1;
      if (covers(entry, line) || collapsedAstRanges.some(range => entry.start >= range.start && entry.end <= range.end)) continue;
      const raw = source.slice(entry.start, entry.end);
      if (!raw.trim()) continue;
      const [kind, tone] = astKind[entry.kind] || ['Java', 'default'];
      nodes.push({
        kind, tone, label: raw.trim().split('\n')[0].slice(0, 140), raw,
        start: line, end: entry.endLine - 1, astStart: entry.start, astEnd: entry.end,
        fieldType: 'astRaw', fields: [['Фрагмент Java', raw]], editable: true, astNode: true
      });
      if (['loop', 'if', 'switch', 'try'].includes(entry.kind)) collapsedAstRanges.push({ start: entry.start, end: entry.end });
    }
    nodes.sort((a, b) => (a.astStart ?? lineStarts[a.start] ?? 0) - (b.astStart ?? lineStarts[b.start] ?? 0));
    return nodes;
  };

  const originalPreservePositions = preservePositions;
  preservePositions = function (nodes, old) {
    originalPreservePositions(nodes, old);
    for (const node of nodes) if (node.astNode) node.id = `ast:${node.astStart}:${node.kind}`;
  };

  const originalPreventOverlap = preventOverlap;
  preventOverlap = function () {
    if (graphNodes.length < 120) return originalPreventOverlap();
    const elements = [...flow.querySelectorAll(':scope > .graph-node')];
    const buckets = new Map();
    const cellWidth = 360, cellHeight = 260;
    const cellsFor = (x, y, width, height) => {
      const result = [];
      for (let cx = Math.floor(x / cellWidth); cx <= Math.floor((x + width) / cellWidth); cx++)
        for (let cy = Math.floor(y / cellHeight); cy <= Math.floor((y + height) / cellHeight); cy++) result.push(`${cx}:${cy}`);
      return result;
    };
    let maxY = 1400;
    elements.forEach((element, index) => {
      const node = graphNodes[index];
      const width = element.offsetWidth + 28, height = element.offsetHeight + 36;
      let x = node.x ?? 60, y = node.y ?? 60;
      for (let attempt = 0; attempt < 200; attempt++) {
        const nearby = new Set(cellsFor(x, y, width, height).flatMap(cell => buckets.get(cell) || []));
        const collisions = [...nearby].filter(box => x < box.x + box.width && x + width > box.x && y < box.y + box.height && y + height > box.y);
        if (!collisions.length) break;
        y = Math.max(...collisions.map(box => box.y + box.height)) + 12;
      }
      node.x = x; node.y = y;
      element.style.left = `${x}px`; element.style.top = `${y}px`;
      const box = { x, y, width, height };
      for (const cell of cellsFor(x, y, width, height)) {
        if (!buckets.has(cell)) buckets.set(cell, []);
        buckets.get(cell).push(box);
      }
      maxY = Math.max(maxY, y + height + 100);
    });
    world.style.height = `${maxY}px`;
    flow.style.height = world.style.height;
    edgesSvg.style.height = world.style.height;
    worldZoom.style.height = `${maxY * zoom / 100}px`;
  };

  function routedEdge(from, to, rectangles, sourceBox, targetBox) {
    const clearance = 7;
    const start = { x: sourceBox.right + clearance + 8, y: from.y };
    const finish = { x: targetBox.left - clearance - 8, y: to.y };
    const obstacles = rectangles.map(rect => ({
      left: rect.left - clearance, right: rect.right + clearance,
      top: rect.top - clearance, bottom: rect.bottom + clearance
    }));
    const intersects = (a, b, rect) => {
      if (a.x === b.x) return a.x > rect.left && a.x < rect.right &&
        Math.max(a.y, b.y) > rect.top && Math.min(a.y, b.y) < rect.bottom;
      return a.y > rect.top && a.y < rect.bottom &&
        Math.max(a.x, b.x) > rect.left && Math.min(a.x, b.x) < rect.right;
    };
    const clear = (a, b, list) => !list.some(rect => intersects(a, b, rect));
    const valid = (points, list) => points.every((point, index) => !index || clear(points[index - 1], point, list));
    const compact = points => points.filter((point, index) => {
      if (!index || index === points.length - 1) return true;
      const previous = points[index - 1], next = points[index + 1];
      return !(previous.x === point.x && point.x === next.x) && !(previous.y === point.y && point.y === next.y);
    });
    if (start.x <= finish.x) {
      const middle = (start.x + finish.x) / 2;
      const simple = [start, { x: middle, y: start.y }, { x: middle, y: finish.y }, finish];
      if (valid(simple, obstacles)) return compact([from, ...simple, to]);
    }

    const search = (padding, limit) => {
      const left = Math.min(start.x, finish.x) - padding;
      const right = Math.max(start.x, finish.x) + padding;
      const top = Math.min(start.y, finish.y) - padding;
      const bottom = Math.max(start.y, finish.y) + padding;
      const nearby = obstacles.filter(rect => rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom);
      if (nearby.length > limit) return null;
      const xs = [...new Set([start.x, finish.x, left, right, ...nearby.flatMap(rect => [rect.left - 8, rect.right + 8])])].sort((a, b) => a - b);
      const ys = [...new Set([start.y, finish.y, top, bottom, ...nearby.flatMap(rect => [rect.top - 8, rect.bottom + 8])])].sort((a, b) => a - b);
      const width = xs.length, height = ys.length;
      if (width * height > 12000) return null;
      const point = (x, y) => ({ x: xs[x], y: ys[y] });
      const blocked = (x, y) => nearby.some(rect => xs[x] > rect.left && xs[x] < rect.right && ys[y] > rect.top && ys[y] < rect.bottom);
      const startX = xs.indexOf(start.x), startY = ys.indexOf(start.y);
      const endX = xs.indexOf(finish.x), endY = ys.indexOf(finish.y);
      const stateId = (x, y, direction) => ((y * width + x) * 2 + direction);
      const startId = stateId(startX, startY, 0);
      const costs = new Map([[startId, 0]]), previous = new Map();
      const heap = [];
      const push = item => { heap.push(item); let i = heap.length - 1; while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent].priority <= item.priority) break; heap[i] = heap[parent]; i = parent; } heap[i] = item; };
      const pop = () => { const first = heap[0], tail = heap.pop(); if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].priority < heap[child].priority) child++; if (heap[child].priority >= tail.priority) break; heap[i] = heap[child]; i = child; } heap[i] = tail; } return first; };
      const heuristic = (x, y) => Math.abs(xs[x] - finish.x) + Math.abs(ys[y] - finish.y);
      push({ x: startX, y: startY, direction: 0, id: startId, cost: 0, priority: heuristic(startX, startY) });
      let goal = null;
      while (heap.length) {
        const current = pop();
        if (current.cost !== costs.get(current.id)) continue;
        if (current.x === endX && current.y === endY) { goal = current.id; break; }
        for (const [dx, dy, direction] of [[1, 0, 0], [-1, 0, 0], [0, 1, 1], [0, -1, 1]]) {
          const nx = current.x + dx, ny = current.y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || blocked(nx, ny)) continue;
          const a = point(current.x, current.y), b = point(nx, ny);
          if (!clear(a, b, nearby)) continue;
          const nextId = stateId(nx, ny, direction);
          const cost = current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (direction === current.direction ? 0 : 24);
          if (cost >= (costs.get(nextId) ?? Infinity)) continue;
          costs.set(nextId, cost);
          previous.set(nextId, current.id);
          push({ x: nx, y: ny, direction, id: nextId, cost, priority: cost + heuristic(nx, ny) });
        }
      }
      if (goal == null) return null;
      const route = [];
      for (let id = goal; id !== undefined; id = previous.get(id)) {
        const cell = Math.floor(id / 2);
        route.push(point(cell % width, Math.floor(cell / width)));
      }
      route.reverse();
      return valid(route, obstacles) ? compact([from, ...route, to]) : null;
    };
    return search(170, 24) || search(420, 48) || search(850, 72) || search(1200, 120);
  }

  window.routeGraphEdges = function (byId) {
    const boxById = new Map([...byId].map(([id, { el }]) => [id, {
      left: el.offsetLeft, top: el.offsetTop,
      right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight
    }]));
    const boxes = [...boxById.values()];
    // The SVG's coordinate system must match the graph world after a card grows,
    // an auto layout, or a drag. A larger CSS height with an old viewBox scales
    // every path and makes even correctly computed port positions look detached.
    const worldWidth = Math.max(1800, Number.parseFloat(world.style.width) || 0,
      ...boxes.map(box => box.right + 80));
    const worldHeight = Math.max(1400, Number.parseFloat(world.style.height) || 0,
      ...boxes.map(box => box.bottom + 80));
    world.style.width = flow.style.width = edgesSvg.style.width = `${worldWidth}px`;
    world.style.height = flow.style.height = edgesSvg.style.height = `${worldHeight}px`;
    edgesSvg.setAttribute('viewBox', `0 0 ${worldWidth} ${worldHeight}`);
    worldZoom.style.width = `${worldWidth * zoom / 100}px`;
    worldZoom.style.height = `${worldHeight * zoom / 100}px`;

    const links = new Map();
    for (const [sourceId, targetId, manual] of graphLinks()) {
      const key = JSON.stringify([sourceId, targetId]);
      links.set(key, [sourceId, targetId, manual || Boolean(links.get(key)?.[2])]);
    }
    for (const [sourceId, targetId, manual] of links.values()) {
      const source = byId.get(sourceId)?.el, target = byId.get(targetId)?.el;
      if (!source || !target) continue;
      const output = source.querySelector('.port.out'), input = target.querySelector('.port.in');
      if (!output || !input) continue;
      const from = { x: source.offsetLeft + output.offsetLeft + output.offsetWidth / 2,
        y: source.offsetTop + output.offsetTop + output.offsetHeight / 2 };
      const to = { x: target.offsetLeft + input.offsetLeft + input.offsetWidth / 2,
        y: target.offsetTop + input.offsetTop + input.offsetHeight / 2 };
      const route = routedEdge(from, to, boxes, boxById.get(sourceId), boxById.get(targetId));
      if (!route) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const commands = [`M ${route[0].x} ${route[0].y}`];
      for (let index = 1; index < route.length; index++) {
        const point = route[index], previous = route[index - 1];
        commands.push(point.x === previous.x ? `V ${point.y}` : `H ${point.x}`);
      }
      path.setAttribute('d', commands.join(' '));
      path.setAttribute('class', `edge-path${manual ? ' manual' : ''}`);
      edgesSvg.appendChild(path);
    }
  };
  drawEdgesFromDom();

  document.getElementById('fitGraph').onclick = () => {
    const nodes = [...flow.querySelectorAll(':scope > .graph-node')];
    if (!nodes.length) { setZoom(100); canvas.scrollTo(0, 0); return; }
    const left = Math.min(...nodes.map(node => node.offsetLeft));
    const top = Math.min(...nodes.map(node => node.offsetTop));
    const right = Math.max(...nodes.map(node => node.offsetLeft + node.offsetWidth));
    const bottom = Math.max(...nodes.map(node => node.offsetTop + node.offsetHeight));
    const scale = Math.min((canvas.clientWidth - 64) / Math.max(1, right - left),
      (canvas.clientHeight - 64) / Math.max(1, bottom - top));
    setZoom(Math.round(Math.max(10, Math.min(200, scale * 100))));
    const factor = zoom / 100;
    canvas.scrollTo({
      left: Math.max(0, (left + right) * factor / 2 - canvas.clientWidth / 2),
      top: Math.max(0, (top + bottom) * factor / 2 - canvas.clientHeight / 2)
    });
    canvas.focus({ preventScroll: true });
  };

  const originalMakeNode = makeNode;
  makeNode = function (node, index) {
    const element = originalMakeNode(node, index);
    if (!node.astNode) return element;
    element.classList.add('ast-node');
    const actions = element.querySelector('.graph-node-actions');
    if (actions) actions.innerHTML = `<button type="button" class="ast-jump">Перейти к коду</button>`;
    element.querySelector('.ast-jump')?.addEventListener('click', () => {
      code.focus();
      code.setSelectionRange(node.astStart, node.astEnd);
      code.scrollTop = Math.max(0, (node.start - 3) * 21);
    });
    if (node.fieldType === 'astRaw') {
      const input = element.querySelector('.graph-field input');
      if (input) {
        const textarea = document.createElement('textarea');
        textarea.dataset.node = String(index);
        textarea.dataset.field = '0';
        textarea.dataset.resizeKey = `${node.id}:raw`;
        textarea.setAttribute('aria-label', 'Исходный код Java');
        textarea.spellcheck = false;
        textarea.value = node.raw;
        input.replaceWith(textarea);
      }
    }
    return element;
  };

  const originalUpdateNodeField = updateNodeField;
  updateNodeField = function (index, field, value) {
    const node = graphNodes[index];
    if (!node?.astNode || node.fieldType !== 'astRaw') return originalUpdateNodeField(index, field, value);
    if (astGraphCache?.file !== active || astGraphCache.source !== code.value) {
      notify('Исходный код изменился. Дождитесь обновления схемы.');
      return;
    }
    beginHistory();
    code.value = code.value.slice(0, node.astStart) + value + code.value.slice(node.astEnd);
    buffers[active] = code.value;
    updateHighlight();
    astGraphCache = null;
    codeToGraph();
    finishHistory();
    scheduleAstGraph();
    scheduleSave();
    scheduleAutoCheck();
  };

  function applyAstGraph(file, source, entries) {
    if (file !== active || source !== code.value) return;
    astGraphCache = { file, source, entries: entries.filter(entry => entry.file === file) };
    document.getElementById('astStatus').textContent = `AST: ${astGraphCache.entries.length} constructs`;
    codeToGraph();
  }

  function scheduleAstGraph() {
    if (!desktop || !active) return;
    const version = ++astGraphVersion;
    clearTimeout(astGraphTimer);
    const file = active, source = code.value;
    document.getElementById('astStatus').textContent = 'AST: обновление…';
    astGraphTimer = setTimeout(async () => {
      try {
        const result = await desktop.invoke('java:analyze', { files: { [file]: source } });
        if (version === astGraphVersion && !result?.error) applyAstGraph(file, source, result.graph || []);
      } catch {
        if (version === astGraphVersion) document.getElementById('astStatus').textContent = 'AST недоступен';
      }
    }, 650);
  }

  // Deterministic 1,000-line fixture: live SKU rules plus the repeated scan.
  const demoRuleCount = 139;
  const demoRules = Array.from({ length: demoRuleCount }, (_, index) => {
    const sku = `SKU${String(index + 1).padStart(3, '0')}`;
    const prefix = sku.toLowerCase() + ':';
    return [
      `        if (value.startsWith("${prefix}")) {`,
      '            String suffix = value.substring(7).trim();',
      '            if (!suffix.isEmpty()) {',
      `                return "${sku}:" + suffix.toLowerCase(java.util.Locale.ROOT);`,
      '            }',
      `            return "${sku}:";`,
      '        }'
    ];
  }).flat();
  const demoNormalize = [
    '    private static String normalize(String raw) {',
    '        String value = raw.trim();',
    ...demoRules,
    '        return value;',
    '    }'
  ];
  const example = [
    'import java.util.ArrayList;',
    'import java.util.List;',
    'import java.util.Scanner;',
    '',
    'public class DemoMonolith {',
    ...demoNormalize,
    '',
    '    public static void main(String[] args) {',
    '        Scanner scanner = new Scanner(System.in);',
    '        List<String> items = new ArrayList<>();',
    '        while (scanner.hasNextLine()) {',
    '            String item = normalize(scanner.nextLine());',
    '            if (!item.isEmpty()) {',
    '                items.add(item);',
    '            }',
    '        }',
    '        for (String item : items) {',
    '            int count = 0;',
    '            for (String candidate : items) {',
    '                if (item.equals(candidate)) {',
    '                    count++;',
    '                }',
    '            }',
    '            System.out.println(item + ":" + count);',
    '        }',
    '    }',
    '}'
  ].join('\n');
  const optimizedExample = {
    'DemoMonolith.java': [
      'import java.util.List;',
      '',
      'public class DemoMonolith {',
      '    public static void main(String[] args) {',
      '        List<String> items = Parser.readItems(System.in);',
      '        Analyzer.printCounts(items);',
      '    }',
      '}'
    ].join('\n'),
    'Parser.java': [
      'import java.io.InputStream;',
      'import java.util.ArrayList;',
      'import java.util.List;',
      'import java.util.Scanner;',
      '',
      'public class Parser {',
      '    public static List<String> readItems(InputStream input) {',
      '        Scanner scanner = new Scanner(input);',
      '        List<String> items = new ArrayList<>();',
      '        while (scanner.hasNextLine()) {',
      '            String item = Normalizer.normalize(scanner.nextLine());',
      '            if (!item.isEmpty()) {',
      '                items.add(item);',
      '            }',
      '        }',
      '        return items;',
      '    }',
      '}'
    ].join('\n'),
    'Analyzer.java': [
      'import java.util.HashMap;',
      'import java.util.List;',
      'import java.util.Map;',
      '',
      'public class Analyzer {',
      '    public static void printCounts(List<String> items) {',
      '        Map<String, Integer> counts = new HashMap<>();',
      '        for (String item : items) {',
      '            counts.put(item, counts.getOrDefault(item, 0) + 1);',
      '        }',
      '        for (String item : items) {',
      '            System.out.println(item + ":" + counts.get(item));',
      '        }',
      '    }',
      '}'
    ].join('\n'),
    'Normalizer.java': [
      'public final class Normalizer {',
      '    private Normalizer() {}',
      ...demoNormalize.map(line => line.replace('private static String normalize', 'public static String normalize')),
      '}'
    ].join('\n')
  };
  if (!buffers['DemoMonolith.java']) buffers['DemoMonolith.java'] = example;
  baseline = { ...buffers };

  function html(text) { return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
  function currentFiles() { if (active) buffers[active] = code.value; return { ...buffers }; }
  function showDock(name) {
    currentDock = name;
    editor.classList.add('bottom-open');
    dock.querySelectorAll('[data-dock]').forEach(button => button.classList.toggle('active', button.dataset.dock === name));
    renderDock();
  }
  function setBusy(value) {
    busy = value;
    toolbar.querySelectorAll('[data-command]').forEach(button => button.disabled = value);
    document.getElementById('message').textContent = value ? 'Выполняется…' : 'Готово';
    if (!value) window.blueprintsCollaboration?.refreshPermissions?.();
  }
  function requireDesktop() {
    if (desktop) return true;
    consoleText = 'Compilation and file operations are available in the Java Blueprints Windows app.';
    consoleError = true;
    showDock('console');
    return false;
  }
  function reportError(result) {
    if (!result?.error) return false;
    consoleText = result.error;
    consoleError = true;
    showDock('console');
    return true;
  }
  function scheduleSave() {
    if (!desktop) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => desktop.invoke('state:save', {
      files: currentFiles(), baseline, tests: testState, active, autoCheck
    }), 900);
  }
  function setAutoStatus(label, state = '') {
    const button = toolbar.querySelector('[data-command="autocheck"]');
    button.classList.remove('verified', 'regression', 'checking');
    if (state) button.classList.add(state);
    document.getElementById('autocheckLabel').textContent = label;
  }
  function scheduleAutoCheck() {
    if (!desktop || !autoCheck || !baseline) return;
    const version = ++autoVersion;
    clearTimeout(autoTimer);
    setAutoStatus('Ожидает проверки', 'checking');
    autoTimer = setTimeout(async () => {
      if (version !== autoVersion) return;
      if (busy || checking) { scheduleAutoCheck(); return; }
      const files = currentFiles();
      if (JSON.stringify(files) === JSON.stringify(baseline)) { setAutoStatus('Без изменений', 'verified'); return; }
      checking = true;
      setAutoStatus('Проверка…', 'checking');
      try {
        const result = await desktop.invoke('java:compare', { baseline, current: files, cases: testState.inputs, mainClass: testState.mainClass });
        if (version !== autoVersion) return;
        compareResult = result;
        if (result?.error || result?.compiled === false) setAutoStatus('Ошибка сборки', 'regression');
        else if (result.passed === result.total) setAutoStatus(`Совпало ${result.passed}/${result.total}`, 'verified');
        else setAutoStatus(`Различие ${result.total - result.passed}/${result.total}`, 'regression');
        if (currentDock === 'tests' && editor.classList.contains('bottom-open')) renderTests();
      } catch { if (version === autoVersion) setAutoStatus('Ошибка проверки', 'regression'); }
      finally { checking = false; }
    }, 2200);
  }
  function renderTree() {
    const tree = document.getElementById('tree');
    const names = Object.keys(buffers).sort((a, b) => a.localeCompare(b));
    const root = { folders: new Map(), files: [] };
    for (const name of names) {
      const parts = name.replaceAll('\\', '/').split('/');
      let cursor = root;
      for (const part of parts.slice(0, -1)) {
        if (!cursor.folders.has(part)) cursor.folders.set(part, { folders: new Map(), files: [] });
        cursor = cursor.folders.get(part);
      }
      cursor.files.push({ name, label: parts.at(-1) });
    }
    tree.innerHTML = `<div class="row active folder-row"><span class="arrow">${iconSvg('chevronDown', 12)}</span><span class="glyph folder">${iconSvg('folderOpen', 14)}</span><b>${html(projectName)}</b></div>`;
    function appendLevel(node, depth, parentPath) {
      for (const [folder, child] of [...node.folders].sort((a, b) => a[0].localeCompare(b[0]))) {
        const key = `${parentPath}/${folder}`;
        const closed = collapsedFolders.has(key);
        const row = document.createElement('div');
        row.className = 'row folder-row';
        row.style.paddingLeft = `${20 + depth * 14}px`;
        row.innerHTML = `<span class="arrow">${iconSvg(closed ? 'chevronRight' : 'chevronDown', 12)}</span><span class="glyph folder">${iconSvg(closed ? 'folder' : 'folderOpen', 14)}</span><span>${html(folder)}</span>`;
        row.addEventListener('click', () => { closed ? collapsedFolders.delete(key) : collapsedFolders.add(key); renderTree(); });
        tree.appendChild(row);
        if (!closed) appendLevel(child, depth + 1, key);
      }
      for (const file of node.files) {
        const row = document.createElement('div');
        row.className = 'row file-row' + (file.name === active ? ' active' : '');
        row.dataset.file = file.name;
        row.style.paddingLeft = `${34 + depth * 14}px`;
        row.innerHTML = `<span class="glyph java">${iconSvg('fileCode', 14)}</span><span title="${html(file.name)}">${html(file.label)}</span>`;
        row.addEventListener('click', () => { showFile(file.name); renderTree(); scheduleSave(); });
        tree.appendChild(row);
      }
    }
    appendLevel(root, 0, '');
    document.getElementById('workspaceName').textContent = projectName;
  }
  function findCodeLocation(file, line) {
    const key = Object.keys(buffers).find(name => name === file || name.endsWith('/' + file));
    if (!key) return;
    showFile(key);
    renderTree();
    const lines = code.value.split('\n');
    const offset = lines.slice(0, Math.max(0, line - 1)).reduce((sum, value) => sum + value.length + 1, 0);
    code.focus();
    code.setSelectionRange(offset, offset + (lines[line - 1]?.length || 0));
    code.scrollTop = Math.max(0, (line - 5) * 21);
    const nodeIndex = graphNodes.findIndex(node => node.start <= line - 1 && node.end >= line - 1);
    if (nodeIndex >= 0) {
      selectedNode = nodeIndex;
      renderGraph();
      const node = graphNodes[nodeIndex];
      canvas.scrollLeft = Math.max(0, node.x * zoom / 100 - 90);
      canvas.scrollTop = Math.max(0, node.y * zoom / 100 - 90);
    }
  }
  function analyzeHeuristic(files) {
    const result = [];
    for (const [file, source] of Object.entries(files)) {
      const lines = source.split('\n');
      let depth = 0;
      const loops = [];
      const methods = [];
      const conditions = new Map();
      lines.forEach((raw, index) => {
        const line = raw.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/\/\/.*$/, '');
        const trimmed = line.trim();
        if (/\b(?:for|while)\s*\(/.test(trimmed) && loops.some(loop => depth >= loop.depth)) {
          result.push({ file, line: index + 1, severity: 'warning', title: 'Вложенный цикл: возможная сложность O(n²)', detail: 'Проверьте повторный поиск по коллекции. Индекс по ключу может сократить время; подтвердите изменение тестами.' });
        }
        if (/\b(?:for|while)\s*\(/.test(trimmed) && trimmed.includes('{')) loops.push({ depth: depth + 1 });
        if (/\b(?:public|private|protected)\b.*\([^;]*\)\s*\{/.test(trimmed)) methods.push({ line: index + 1, depth: depth + 1 });
        const cond = trimmed.match(/^if\s*\((.+)\)\s*\{/);
        if (cond) {
          const normalized = cond[1].replace(/\s+/g, '');
          if (conditions.has(normalized)) result.push({ file, line: index + 1, severity: 'info', title: 'Повторяется условие', detail: `То же условие встречается на строке ${conditions.get(normalized)}. Возможно, проверку стоит вынести в метод.` });
          else conditions.set(normalized, index + 1);
        }
        if (/new\s+(?:ArrayList|HashMap|HashSet)\s*\(\s*\)/.test(trimmed)) result.push({ file, line: index + 1, severity: 'info', title: 'Не указан тип при создании коллекции', detail: 'Проверьте обобщённый тип и используйте <> там, где это уместно.' });
        depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        while (loops.length && depth < loops.at(-1).depth) loops.pop();
        while (methods.length && depth < methods.at(-1).depth) {
          const method = methods.pop();
          const size = index + 1 - method.line;
          if (size > 40) result.push({ file, line: method.line, severity: 'warning', title: `Длинный метод: ${size + 1} строк`, detail: 'Рассмотрите выделение отдельных обязанностей в методы или классы.' });
        }
      });
    }
    return result;
  }
  async function refreshAnalysis(files) {
    if (!desktop) { findings = analyzeHeuristic(files); outline = []; return; }
    const result = await desktop.invoke('java:analyze', { files });
    if (result?.error) throw new Error(result.error);
    findings = [...(result.findings || []), ...(result.syntaxErrors || [])];
    outline = result.outline || [];
    refactors = result.refactors || [];
    if (active && Object.hasOwn(files, active)) applyAstGraph(active, files[active], result.graph || []);
  }
  function renderAnalysis() {
    const all = [...compileDiagnostics.map(x => ({ file: x.file, line: x.line, severity: x.severity, title: x.message, detail: 'Диагностика компилятора Java' })), ...findings];
    document.getElementById('problemCount').textContent = all.length ? `(${all.length})` : '';
    if (!all.length) { dockContent.innerHTML = '<div class="dock-empty">Проблем не найдено. Анализ вложенных циклов и длинных методов носит рекомендательный характер.</div>'; return; }
    dockContent.innerHTML = all.map((item, index) => `<div class="diagnostic-row" data-finding="${index}" role="button" tabindex="0"><span class="severity-${html(item.severity)}">${item.severity === 'error' ? '●' : item.severity === 'warning' ? '▲' : 'ⓘ'}</span><span><span class="diagnostic-title">${html(item.title)}</span><div class="diagnostic-detail">${html(item.detail)}</div></span><span class="location">${html(item.file)}:${item.line}</span></div>`).join('');
    dockContent.querySelectorAll('[data-finding]').forEach(row => {
      const open = () => { const item = all[Number(row.dataset.finding)]; findCodeLocation(item.file, item.line); };
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => { if (event.key === 'Enter') open(); });
    });
  }
  function renderConsole() {
    dockContent.innerHTML = `<pre class="console-output ${consoleError ? 'console-error' : 'console-success'}">${html(consoleText)}</pre>`;
  }
  function renderStructure() {
    if (!outline.length) { dockContent.innerHTML = '<div class="dock-empty">Откройте проект и запустите анализ для построения структуры Java.</div>'; return; }
    dockContent.innerHTML = outline.map((item, index) => `<div class="diagnostic-row structure-row" data-outline="${index}" role="button" tabindex="0"><span>${item.kind === 'class' ? '▣' : item.kind === 'method' ? 'ƒ' : item.kind === 'loop' ? '⟳' : '◇'}</span><span style="padding-left:${Math.min(item.depth || 0, 4) * 10}px">${html(item.name)} <small>${html(item.kind)}</small></span><span class="location">${html(item.file)}:${item.line}–${item.endLine}</span></div>`).join('');
    dockContent.querySelectorAll('[data-outline]').forEach(row => {
      const open = () => { const item = outline[Number(row.dataset.outline)]; findCodeLocation(item.file, item.line); };
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => { if (event.key === 'Enter') open(); });
    });
  }
  function renderTests() {
    const rows = compareResult?.results?.map((item, index) => `<div class="test-result ${item.pass ? 'pass' : 'fail'}"><b>Случай ${index + 1}: ${item.pass ? 'поведение совпадает' : html(item.difference || 'различие')}</b><div>Вход: ${html(item.input || '(пустой)')}</div>${item.pass ? '' : `<div>Было: ${html(item.before.stdout || item.before.stderr)}</div><div>Стало: ${html(item.after.stdout || item.after.stderr)}</div>`}</div>`).join('') || '';
    const probePanel = probeResult ? `<div class="probe-card ${probeResult.counterexample ? 'fail' : 'pass'}"><b>${probeResult.counterexample ? `Найден контрпример после ${probeResult.checked} запусков: ${html(probeResult.counterexample.difference)}` : `Контрпример не найден за ${probeResult.checked} запусков`}</b>${probeResult.counterexample ? `<pre>Input:\n${html(probeResult.counterexample.input || '(пустой)')}\nBefore:\n${html((probeResult.counterexample.before.stdout || probeResult.counterexample.before.stderr).slice(0, 4000))}\nAfter:\n${html((probeResult.counterexample.after.stdout || probeResult.counterexample.after.stderr).slice(0, 4000))}</pre><button id="addCounterexample">Добавить в сценарии</button>` : '<p>Это не доказывает полную эквивалентность. Проверьте дополнительные реальные входы.</p>'}</div>` : '';
    dockContent.innerHTML = `<div class="test-grid"><div><h3>Входные данные</h3><label>Один сценарий на секцию, разделитель — строка из трёх дефисов</label><textarea id="testInputs" spellcheck="false">${html(testState.inputs.join('\n---\n'))}</textarea><label style="margin-top:8px">Главный класс (если в проекте несколько main)</label><input id="mainClassInput" value="${html(testState.mainClass)}" placeholder="Например, com.example.Main"><label style="margin-top:8px">Ввод для обычного запуска</label><textarea id="runInput" spellcheck="false" placeholder="stdin для запуска">${html(testState.stdin)}</textarea></div><div><h3>Результаты</h3><p>Исходная версия: ${baseline ? `${Object.keys(baseline).length} Java-файлов` : 'не зафиксирована'}. Сравниваются код завершения, stdout и stderr.</p>${compareResult?.error ? `<p class="console-error">${html(compareResult.error)}</p>` : ''}${compareResult?.compiled === false ? '<p class="console-error">Одна из версий не компилируется; подробности в консоли.</p>' : ''}${compareResult?.total != null ? `<p class="${compareResult.passed === compareResult.total ? 'console-success' : 'console-error'}">Успешно: ${compareResult.passed} / ${compareResult.total}</p>` : ''}${probePanel}${rows}</div></div>`;
    dockContent.querySelector('#testInputs').addEventListener('input', event => { testState.inputs = event.target.value.split(/\r?\n---\r?\n/); scheduleSave(); });
    dockContent.querySelector('#runInput').addEventListener('input', event => { testState.stdin = event.target.value; scheduleSave(); });
    dockContent.querySelector('#mainClassInput').addEventListener('input', event => { testState.mainClass = event.target.value.trim(); scheduleSave(); });
    dockContent.querySelector('#addCounterexample')?.addEventListener('click', () => {
      const input = probeResult.counterexample.input;
      if (!testState.inputs.includes(input)) testState.inputs.unshift(input);
      scheduleSave(); renderTests();
    });
  }
  function renderDock() {
    if (currentDock === 'analysis') renderAnalysis();
    else if (currentDock === 'structure') renderStructure();
    else if (currentDock === 'console') renderConsole();
    else renderTests();
  }
  function makeExtraction(files, method) {
    const source = files[method.file];
    if (!source || !/^[A-Za-z_$][\w$]*$/.test(method.className)) throw new Error('Could not determine the method class.');
    const header = source.slice(method.start, method.bodyStart);
    if (!/\bstatic\b/.test(header) || /\b(?:synchronized|native|abstract)\b|@/.test(header))
      throw new Error('This method cannot be extracted safely.');
    const directory = method.file.includes('/') ? method.file.slice(0, method.file.lastIndexOf('/') + 1) : '';
    let suffix = '', counter = 2;
    while (Object.hasOwn(files, `${directory}${method.className}Extracted${suffix}.java`)) suffix = String(counter++);
    const helperName = `${method.className}Extracted${suffix}`;
    const helperFile = `${directory}${helperName}.java`;
    const targetName = method.name === 'main' ? 'run' : method.name;
    const exportedHeader = header.replace(/\b(?:public|private|protected)\b\s*/, '').trimStart()
      .replace(new RegExp(`\\b${method.name}\\s*(?=\\()`), targetName);
    const originalMethod = `    public ${exportedHeader}${source.slice(method.bodyStart, method.end)}`;
    const packageLine = source.match(/^\s*package\s+[^;]+;/m)?.[0]?.trim() || '';
    const imports = [...source.matchAll(/^\s*import\s+[^;]+;/gm)].map(match => match[0].trim()).join('\n');
    const helperSource = [packageLine, imports, `public final class ${helperName} {`,
      `    private ${helperName}() {}`, originalMethod, '}'].filter(Boolean).join('\n\n') + '\n';
    const invocation = `${helperName}.${targetName}(${method.parameters.join(', ')})`;
    const wrapper = method.returnType === 'void' ? `{ ${invocation}; }` : `{ return ${invocation}; }`;
    return { ...files, [method.file]: source.slice(0, method.bodyStart) + wrapper + source.slice(method.bodyEnd),
      [helperFile]: helperSource };
  }

  async function extractMethod() {
    if (!requireDesktop()) return;
    const files = currentFiles();
    setBusy(true);
    try {
      const analysis = await desktop.invoke('java:analyze', { files });
      if (analysis?.error) throw new Error(analysis.error);
      if (analysis.syntaxErrors?.length) throw new Error('Fix Java syntax errors first.');
      const cursorLine = code.value.slice(0, code.selectionStart).split('\n').length;
      const candidates = (analysis.refactors || []).filter(item => item.file === active);
      const method = candidates.find(item => item.line <= cursorLine && item.endLine >= cursorLine)
        || [...candidates].sort((a, b) => (b.endLine - b.line) - (a.endLine - a.line))[0];
      if (!method) throw new Error('No extractable static method in this file. Select a method in the code editor.');
      const proposed = makeExtraction(files, method);
      const compiled = await desktop.invoke('java:compile', { files: proposed });
      if (compiled?.error || compiled.code !== 0)
        throw new Error(`Method ${method.name} was not extracted: the new class does not compile.\n${compiled.stderr || compiled.error || ''}`);
      const detectedMain = analysis.mainClasses?.length === 1 ? analysis.mainClasses[0].className : '';
      const compared = await desktop.invoke('java:compare', {
        baseline: files, current: proposed, cases: testState.inputs,
        mainClass: testState.mainClass || detectedMain
      });
      if (compared?.error || compared.compiled === false || compared.passed !== compared.total)
        throw new Error(`Method ${method.name} was not extracted: behavior check failed. ${compared?.error || `${compared?.passed || 0}/${compared?.total || 0} scenarios matched`}`);
      baseline = files;
      autoVersion++;
      probeResult = null;
      Object.assign(buffers, proposed);
      showFile(method.file);
      renderTree();
      compareResult = compared;
      setAutoStatus(`Совпало ${compared.passed}/${compared.total}`, 'verified');
      scheduleSave();
      showDock('tests');
      await refreshAnalysis(currentFiles());
    } catch (error) {
      consoleText = error.message || String(error);
      consoleError = true;
      showDock('console');
    } finally { setBusy(false); }
  }
  async function command(name) {
    if (busy) return;
    const shared = window.blueprintsCollaboration?.state;
    if (shared?.connected && name === 'open') {
      consoleText = 'Leave the shared project before opening a local project.';
      consoleError = true;
      showDock('console');
      return;
    }
    if (shared?.role === 'viewer' && ['load-demo', 'optimize-example', 'extract-method', 'baseline'].includes(name)) {
      consoleText = 'This shared project is view-only.';
      consoleError = true;
      showDock('console');
      return;
    }
    if (name === 'load-demo') {
      if (window.blueprintsCollaboration?.state.connected) {
        consoleText = 'Leave the shared project before opening the local case demo.';
        consoleError = true;
        showDock('console');
        return;
      }
      if (!window.confirm('Open the 1,000-line case demo? This replaces the current local workspace. Save or export your work first.')) return;
      autoVersion++;
      clearTimeout(autoTimer);
      Object.keys(buffers).forEach(file => delete buffers[file]);
      buffers['DemoMonolith.java'] = example;
      baseline = { ...buffers };
      testState.mainClass = 'DemoMonolith';
      projectName = 'Java Blueprints Case';
      opened = [];
      active = '';
      findings = [];
      outline = [];
      compileDiagnostics = [];
      compareResult = null;
      probeResult = null;
      showFile('DemoMonolith.java');
      renderTree();
      setAutoStatus('Baseline ready', 'verified');
      scheduleSave();
      showDock('analysis');
      try { await refreshAnalysis(currentFiles()); }
      catch (error) { consoleText = error.message || String(error); consoleError = true; showDock('console'); }
      return;
    }
    if (name === 'extract-method') return extractMethod();
    if (name === 'autocheck') {
      autoCheck = !autoCheck;
      toolbar.querySelector('[data-command="autocheck"]').classList.toggle('enabled', autoCheck);
      clearTimeout(autoTimer);
      if (autoCheck) scheduleAutoCheck();
      else setAutoStatus('Автопроверка выкл.');
      scheduleSave();
      return;
    }
    if (name === 'optimize-example') {
      const files = currentFiles();
      if (files['DemoMonolith.java'] !== example) {
        consoleText = 'This command applies to the unchanged DemoMonolith.java. For other projects, use diagnostics, the flowchart editor, and manual code edits.';
        consoleError = true;
        showDock('console');
        return;
      }
      const collisions = ['Parser.java', 'Analyzer.java', 'Normalizer.java'].filter(file => Object.hasOwn(files, file));
      if (collisions.length) {
        consoleText = `The example needs ${collisions.join(' and ')}. Move or rename the existing file before applying it.`;
        consoleError = true;
        showDock('console');
        return;
      }
      if (!requireDesktop()) return;
      const proposed = { ...files, ...optimizedExample };
      autoVersion++;
      clearTimeout(autoTimer);
      setBusy(true);
      try {
        const checked = await desktop.invoke('java:compare', {
          baseline: files, current: proposed, cases: testState.inputs, mainClass: 'DemoMonolith'
        });
        if (checked?.error || checked?.compiled === false || !checked?.total || checked.passed !== checked.total) {
          compareResult = checked;
          const summary = checked?.error || (checked?.compiled === false
            ? `Baseline: ${checked.baseline?.stderr || 'build failed'}\nOptimized: ${checked.current?.stderr || 'build failed'}`
            : `Behavior differs in ${(checked?.total || 0) - (checked?.passed || 0)} of ${checked?.total || 0} scenarios.`);
          throw new Error(`Example optimization was not applied. ${summary}`);
        }
        baseline = files;
        testState.mainClass = 'DemoMonolith';
        probeResult = null;
        compareResult = checked;
        Object.assign(buffers, proposed);
        showFile('DemoMonolith.java');
        renderTree();
        setAutoStatus(`Matched ${checked.passed}/${checked.total}`, 'verified');
        scheduleSave();
        showDock('tests');
        try { await refreshAnalysis(currentFiles()); }
        catch (error) { consoleText = error.message || String(error); consoleError = true; }
      } catch (error) {
        consoleText = error.message || String(error);
        consoleError = true;
        showDock('console');
      } finally { setBusy(false); }
      return;
    }
    if (name === 'baseline') {
      baseline = currentFiles();
      autoVersion++;
      probeResult = null;
      setAutoStatus('Без изменений', 'verified');
      compareResult = null;
      scheduleSave();
      showDock('tests');
      return;
    }
    if (name === 'analyze') {
      const files = currentFiles();
      compileDiagnostics = [];
      if (desktop) {
        setBusy(true);
        try {
          const [result] = await Promise.all([desktop.invoke('java:compile', { files }), refreshAnalysis(files)]);
          if (reportError(result)) return;
          compileDiagnostics = result.diagnostics || [];
        } catch (error) {
          consoleText = error.message || String(error);
          consoleError = true;
          showDock('console');
          return;
        } finally { setBusy(false); }
      } else await refreshAnalysis(files);
      showDock('analysis');
      return;
    }
    if (!requireDesktop()) return;
    setBusy(true);
    try {
      let result;
      if (name === 'open') {
        result = await desktop.invoke('project:open');
        if (result?.canceled || reportError(result)) return;
        Object.keys(buffers).forEach(key => delete buffers[key]);
        Object.assign(buffers, result.files);
        baseline = { ...result.files };
        autoVersion++;
        probeResult = null;
        setAutoStatus('Без изменений', 'verified');
        projectName = result.root.split(/[\\/]/).at(-1);
        opened = []; active = '';
        const first = Object.keys(buffers).find(key => /Main\.java$/.test(key)) || Object.keys(buffers)[0];
        showFile(first); renderTree(); findings = []; outline = []; compileDiagnostics = []; compareResult = null;
        scheduleSave();
        return;
      }
      if (name === 'save' || name === 'export') {
        result = await desktop.invoke(name === 'save' ? 'project:save' : 'project:export', { files: currentFiles() });
        if (result?.canceled || reportError(result)) return;
        projectName = result.root.split(/[\\/]/).at(-1);
        renderTree();
        consoleText = `Saved ${result.count} Java files to ${result.root}`;
        consoleError = false;
        showDock('console'); scheduleSave();
        return;
      }
      if (name === 'compile') {
        result = await desktop.invoke('java:compile', { files: currentFiles() });
        if (reportError(result)) return;
        compileDiagnostics = result.diagnostics || [];
        consoleText = result.code === 0 ? `Build completed successfully. ${Object.keys(buffers).length} Java files.` : result.stderr || 'Compilation failed';
        consoleError = result.code !== 0;
        showDock(result.code === 0 ? 'console' : 'analysis');
        return;
      }
      if (name === 'run') {
        result = await desktop.invoke('java:run', { files: currentFiles(), stdin: testState.stdin, mainClass: testState.mainClass });
        if (reportError(result)) return;
        compileDiagnostics = result.diagnostics || [];
        consoleText = `[${result.stage === 'run' ? 'Java' : 'Build'}] ${result.mainClass || ''}\n${result.stdout || ''}${result.stderr ? '\n' + result.stderr : ''}\nExit code: ${result.code}`;
        consoleError = result.code !== 0;
        showDock('console');
        return;
      }
      if (name === 'compare') {
        if (!baseline) { consoleText = 'Capture a baseline first.'; consoleError = true; showDock('console'); return; }
        result = await desktop.invoke('java:compare', { baseline, current: currentFiles(), cases: testState.inputs, mainClass: testState.mainClass });
        if (reportError(result)) return;
        compareResult = result;
        if (result.compiled === false) {
          consoleText = `Baseline:\n${result.baseline.stderr}\nCurrent version:\n${result.current.stderr}`;
          consoleError = true;
        }
        showDock('tests');
      }
      if (name === 'probe') {
        if (!baseline) { consoleText = 'Capture a baseline first.'; consoleError = true; showDock('console'); return; }
        result = await desktop.invoke('java:probe', { baseline, current: currentFiles(), cases: testState.inputs, mainClass: testState.mainClass });
        if (reportError(result)) return;
        if (result.compiled === false) {
          consoleText = `Baseline:\n${result.baseline.stderr}\nCurrent version:\n${result.current.stderr}`;
          consoleError = true; showDock('console'); return;
        }
        probeResult = result;
        showDock('tests');
      }
    } catch (error) {
      consoleText = error.message || String(error);
      consoleError = true;
      showDock('console');
    } finally { setBusy(false); }
  }

  toolbar.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => command(button.dataset.command)));
  dock.querySelectorAll('[data-dock]').forEach(button => button.addEventListener('click', () => showDock(button.dataset.dock)));
  dock.querySelector('.close-dock').addEventListener('click', () => editor.classList.remove('bottom-open'));
  document.getElementById('runButton').onclick = () => command('run');
  document.getElementById('debugButton').onclick = () => command('analyze');
  document.getElementById('terminalButton').onclick = () => showDock('console');
  code.addEventListener('input', scheduleSave);
  code.addEventListener('input', scheduleAstGraph);
  flow.addEventListener('change', scheduleSave);
  flow.addEventListener('change', () => setTimeout(scheduleAstGraph, 0));
  code.addEventListener('input', scheduleAutoCheck);
  flow.addEventListener('change', scheduleAutoCheck);
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') { event.preventDefault(); command('save'); }
  }, true);
  document.addEventListener('keyup', event => {
    if ((event.ctrlKey || event.metaKey) && ['KeyZ', 'KeyY'].includes(event.code)) {
      scheduleAutoCheck();
      scheduleAstGraph();
    }
  });
  window.blueprintsWorkbench = {
    command, showDock, renderTree, scheduleSave, scheduleAstGraph,
    getProject: () => ({ files: currentFiles(), active, positions: Object.fromEntries(graphNodes.map(node => [`${active}:${node.id}`, { x: node.x, y: node.y }])) }),
    replaceRemoteProject(files) {
      if (!files || typeof files !== 'object') return;
      Object.keys(buffers).forEach(key => delete buffers[key]);
      Object.assign(buffers, files);
      opened = [];
      active = '';
      const first = Object.keys(files)[0];
      if (first) showFile(first);
      else {
        code.value = '';
        graphNodes = [];
        selectedNode = -1;
        renderTabs();
        codeToGraph();
        updateHighlight();
      }
      renderTree();
      scheduleSave();
    },
    applyRemoteFile(name, source) {
      if (source === null) {
        delete buffers[name];
        opened = opened.filter(item => item !== name);
        if (name === active) {
          active = '';
          const next = Object.keys(buffers)[0];
          if (next) showFile(next);
          else { code.value = ''; renderTabs(); codeToGraph(); updateHighlight(); }
        }
        renderTree();
        scheduleSave();
        return;
      }
      if (buffers[name] === source && (name !== active || code.value === source)) return;
      buffers[name] = source;
      if (name === active) {
        const start = code.selectionStart, end = code.selectionEnd;
        code.value = source;
        codeToGraph();
        updateHighlight();
        code.setSelectionRange(Math.min(start, source.length), Math.min(end, source.length));
        scheduleAstGraph();
      }
      renderTree();
      scheduleSave();
    },
    applyRemotePosition(key, position) {
      const prefix = `${active}:`;
      if (!key.startsWith(prefix) || !position) return;
      const node = graphNodes.find(item => item.id === key.slice(prefix.length));
      const element = node && flow.querySelector(`.graph-node[data-id="${CSS.escape(node.id)}"]`);
      if (!node || !element) return;
      node.x = position.x; node.y = position.y;
      element.style.left = `${position.x}px`; element.style.top = `${position.y}px`;
      drawEdgesFromDom();
    }
  };
  renderTree();
  const fitInitialGraph = () => setTimeout(() => document.getElementById('fitGraph').click(), 350);
  if (desktop) desktop.invoke('state:load').then(state => {
    if (!state || state.error || !state.files || !Object.keys(state.files).length) return;
    Object.keys(buffers).forEach(key => delete buffers[key]);
    Object.assign(buffers, state.files);
    baseline = state.baseline || { ...buffers };
    Object.assign(testState, state.tests || {});
    autoCheck = state.autoCheck !== false;
    toolbar.querySelector('[data-command="autocheck"]').classList.toggle('enabled', autoCheck);
    if (!autoCheck) setAutoStatus('Автопроверка выкл.');
    projectName = state.root ? state.root.split(/[\\/]/).at(-1) : 'Java Blueprints';
    opened = []; active = '';
    showFile(state.active in buffers ? state.active : Object.keys(buffers)[0]);
    renderTree();
  }).catch(() => {}).finally(fitInitialGraph);
  else fitInitialGraph();
})();
