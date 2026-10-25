(() => {
  document.documentElement.lang = 'en';

  // Translate presentation text only. The Russian node kinds in data attributes
  // remain stable so existing projects and code generation keep working.
  const phrases = Object.entries({
    'Главное меню': 'Main menu', 'Проект': 'Project', 'Блоки': 'Blocks',
    'Структура': 'Structure', 'Сервисы': 'Services', 'Терминал': 'Terminal',
    'Проблемы': 'Problems', 'Контроль версий': 'Version control',
    'Дополнительно': 'More', 'Другие действия': 'More actions',
    'Поиск': 'Search', 'Настройки': 'Settings', 'Запустить': 'Run',
    'Отладка': 'Debug', 'Открыть файл': 'Open file',
    'Закрыть вкладку': 'Close tab', 'Копировать код': 'Copy code',
    'Режим записи': 'Editing mode',
    'Изменить ширину менеджера проекта': 'Resize project panel',
    'Изменить ширину корзины блоков': 'Resize block library',
    'Изменить ширину областей': 'Resize editor panes',
    'Поиск блоков...': 'Search blocks...',
    'Основные': 'Basics', 'Условия': 'Conditions', 'Циклы': 'Loops',
    'Исключения': 'Exceptions', 'Коллекции': 'Collections',
    'Метод': 'Method', 'Переменная': 'Variable',
    'Вывод (print)': 'Output (print)', 'Вывод': 'Output',
    'Операция': 'Operation', 'Возврат': 'Return',
    'Условие if / else': 'If / else condition', 'Условие': 'Condition',
    'Переключатель': 'Switch', 'Цикл for each': 'For-each loop',
    'Цикл while': 'While loop', 'Цикл': 'Loop',
    'Бросить исключение': 'Throw exception',
    'Обработка исключения': 'Exception handling', 'Исключение': 'Exception',
    'Список': 'List', 'Код': 'Code', 'Блок-схема': 'Flowchart',
    'Уменьшить': 'Zoom out', 'Увеличить': 'Zoom in',
    'По размеру': 'Fit to view', 'иначе': 'otherwise',
    'Иначе, если условия выше не сработали': 'Otherwise, if earlier conditions did not match',
    'Условие if': 'If condition', 'Условие else if': 'Else-if condition',
    'Условие ветки': 'Branch condition', 'Код ветки': 'Branch code',
    'Выражение switch': 'Switch expression', 'Выражение': 'Expression',
    'Параметры цикла': 'Loop parameters', 'Текст вывода': 'Output text',
    'Тип': 'Type', 'Имя': 'Name', 'Значение': 'Value',
    'Фрагмент Java': 'Java fragment', 'Исходный код Java': 'Java source code',
    'Вход соединения': 'Connection input', 'Выход соединения': 'Connection output',
    'Вход': 'Input', 'Выход': 'Output',
    'Удалить': 'Delete', '− ветка': '− branch',
    'Перейти к коду': 'Go to code',
    'Код пока не содержит распознаваемых блоков': 'No recognizable blocks in this code yet',
    'Открыть папку с Java-проектом': 'Open a Java project folder',
    'Сохранить Java-файлы в папку проекта': 'Save Java files to the project folder',
    'Экспортировать Java-файлы': 'Export Java files',
    'Анализировать код и проверить сборку': 'Analyze code and check the build',
    'Показать декомпозицию и устранение вложенного поиска на демонстрационном примере': 'Show decomposition and remove nested search in the demo',
    'Перенести самостоятельный статический метод в отдельный класс с проверкой компиляции и поведения': 'Extract a static method into a class and verify the build and behavior',
    'Скомпилировать весь проект': 'Compile the entire project',
    'Собрать и запустить главный класс': 'Build and run the main class',
    'Запомнить текущую версию перед изменениями': 'Save the current version before changes',
    'Сравнить вывод исходной и текущей версий': 'Compare output with the original version',
    'Найти вход, на котором исходная и текущая версии ведут себя по-разному': 'Find input where the versions behave differently',
    'Автоматически проверять поведение после изменений': 'Automatically compare behavior after changes',
    'Покрытие схемы синтаксическим деревом Java': 'Flowchart coverage from the Java syntax tree',
    'Открыть': 'Open', 'Сохранить': 'Save', 'Экспорт': 'Export',
    'Анализ': 'Analysis', 'Улучшить пример': 'Improve example',
    'Извлечь метод': 'Extract method', 'Сборка': 'Build',
    'Запуск': 'Run', 'Исходная версия': 'Baseline',
    'Проверить поведение': 'Compare behavior', 'Контрпример': 'Counterexample',
    'Автопроверка': 'Auto check', 'Локальный пример': 'Local example',
    'Консоль': 'Console', 'Проверка поведения': 'Behavior check',
    'Скрыть панель': 'Hide panel',
    'Сборка ещё не запускалась.': 'The build has not run yet.',
    'Исходный код изменился. Дождитесь обновления схемы.': 'Source changed. Wait for the flowchart to update.',
    'Выполняется…': 'Working…', 'Готово': 'Ready',
    'Ожидает проверки': 'Waiting for check', 'Без изменений': 'No changes',
    'Проверка…': 'Checking…', 'Ошибка сборки': 'Build failed',
    'Ошибка проверки': 'Check failed', 'Автопроверка выкл.': 'Auto check off',
    'Отменено': 'Undone', 'Повторено': 'Redone',
    'Схема выровнена по сетке': 'Flowchart arranged on the grid',
    'Код скопирован': 'Code copied',
    'Буфер обмена недоступен': 'Clipboard unavailable',
    'Проблем не найдено. Анализ вложенных циклов и длинных методов носит рекомендательный характер.': 'No problems found. Nested-loop and long-method findings are advisory.',
    'Откройте проект и запустите анализ для построения структуры Java.': 'Open a project and run analysis to build the Java structure.',
    'Диагностика компилятора Java': 'Java compiler diagnostic',
    'Вложенный цикл: возможная сложность O(n²)': 'Nested loop: possible O(n²) complexity',
    'Проверьте повторный поиск по коллекции. Индекс по ключу может сократить время; подтвердите изменение тестами.': 'Check repeated collection searches. A keyed index may reduce time; confirm with tests.',
    'Повторяется условие': 'Repeated condition',
    'Не указан тип при создании коллекции': 'Missing type when creating a collection',
    'Проверьте обобщённый тип и используйте <> там, где это уместно.': 'Check the generic type and use <> where appropriate.',
    'Рассмотрите выделение отдельных обязанностей в методы или классы.': 'Consider extracting separate responsibilities into methods or classes.',
    'Входные данные': 'Test input', 'Результаты': 'Results',
    'Один сценарий на секцию, разделитель — строка из трёх дефисов': 'One scenario per section, separated by a line with three hyphens',
    'Главный класс (если в проекте несколько main)': 'Main class (if the project has multiple entry points)',
    'Ввод для обычного запуска': 'Input for a normal run',
    'Например, com.example.Main': 'For example, com.example.Main',
    'stdin для запуска': 'stdin for the run',
    'не зафиксирована': 'not captured',
    'Сравниваются код завершения, stdout и stderr.': 'Exit code, stdout, and stderr are compared.',
    'Одна из версий не компилируется; подробности в консоли.': 'One version does not compile; see the console.',
    'Это не доказывает полную эквивалентность. Проверьте дополнительные реальные входы.': 'This does not prove full equivalence. Check additional real inputs.',
    'Добавить в сценарии': 'Add to scenarios',
    'Сначала зафиксируйте исходную версию.': 'Capture a baseline first.',
    'Компиляция и работа с файлами доступны в Windows-приложении Java Blueprints.': 'Compilation and file operations are available in the Java Blueprints Windows app.',
    'Команда применима к неизменённому DemoMonolith.java. Для другого проекта используйте диагностику, редактор схемы и ручное изменение кода.': 'This command applies to the unchanged DemoMonolith.java. For other projects, use diagnostics, the flowchart editor, and manual code edits.',
    'Не удалось определить класс метода.': 'Could not determine the method class.',
    'Этот метод нельзя безопасно вынести автоматически.': 'This method cannot be extracted safely.',
    'Сначала исправьте синтаксические ошибки Java.': 'Fix Java syntax errors first.',
    'В текущем файле нет статического метода, который можно вынести. Выберите метод в редакторе кода.': 'No extractable static method in this file. Select a method in the code editor.',
    'Ошибка компиляции': 'Compilation failed',
    'Найден контрпример': 'Counterexample found',
    'Контрпример не найден': 'No counterexample found',
    'поведение совпадает': 'behavior matches', 'различие': 'difference',
    'пустой': 'empty', 'Было': 'Before', 'Стало': 'After',
    'Случай': 'Case', 'Вход:': 'Input:', 'Успешно:': 'Passed:',
    'Текущая версия:': 'Current version:',
    'Код завершения:': 'Exit code:',
    'AST недоступен': 'AST unavailable', 'AST: обновление…': 'AST: updating…',
    'Изменения в': 'Changes in', 'Добавлен блок:': 'Block added:',
    'Запуск конфигурации Current File': 'Running Current File configuration',
    'Отладка Current File': 'Debugging Current File',
    'условный оператор': 'conditional statement', 'цикл': 'loop',
    'вернуть значение': 'return a value', 'создать экземпляр': 'create an instance',
    'проверка коллекции': 'collection check', 'сравнение объектов': 'object comparison',
    'литерал': 'literal', 'переменная проекта': 'project variable',
    'проверка на null': 'null check', 'логическое ИЛИ': 'logical OR',
    'логическое И': 'logical AND'
  }).sort((a, b) => b[0].length - a[0].length);

  const skip = '.highlight,.code-wrap,.graph-node-code,.tree,pre,code,script,style,textarea';
  const cyrillic = /[А-Яа-яЁё]/;
  const translate = source => {
    if (!cyrillic.test(source)) return source;
    let result = source;
    for (const [russian, english] of phrases) result = result.replaceAll(russian, english);
    result = result.replace(/(\d+) ветви/g, '$1 branches')
      .replace(/(\d+) ветка/g, '$1 branch')
      .replace(/Значение (\d+)/g, 'Value $1')
      .replace(/Совпало (\d+\/\d+)/g, 'Matched $1')
      .replace(/Различие (\d+\/\d+)/g, 'Mismatch $1')
      .replace(/Длинный метод: (\d+) строк/g, 'Long method: $1 lines')
      .replace(/То же условие встречается на строке (\d+)\. Возможно, проверку стоит вынести в метод\./g,
        'The same condition occurs on line $1. Consider extracting the check into a method.')
      .replace(/Сохранено (\d+) Java-файлов в /g, 'Saved $1 Java files to ')
      .replace(/(\d+) Java-файлов/g, '$1 Java files')
      .replace(/сценариев совпали/g, 'scenarios matched')
      .replace(/после (\d+) запусков/g, 'after $1 runs')
      .replace(/за (\d+) запусков/g, 'in $1 runs');
    return result;
  };

  const visit = root => {
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement?.closest(skip)) return;
      const value = translate(root.nodeValue);
      if (value !== root.nodeValue) root.nodeValue = value;
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || root.matches(skip) || root.closest(skip)) return;
    for (const name of ['title', 'placeholder', 'aria-label']) {
      const oldValue = root.getAttribute(name);
      if (oldValue) {
        const value = translate(oldValue);
        if (value !== oldValue) root.setAttribute(name, value);
      }
    }
    for (const child of root.childNodes) visit(child);
  };
  visit(document.body);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') visit(record.target);
      else if (record.type === 'attributes') visit(record.target);
      else for (const node of record.addedNodes) visit(node);
    }
  });
  observer.observe(document.body, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label']
  });

  const desktop = window.blueprintsDesktop;
  document.querySelectorAll('.top .window-btn').forEach((button, index) => {
    const commands = ['window:minimize', 'window:toggleMaximize', 'window:close'];
    const labels = ['Minimize', 'Maximize or restore', 'Close'];
    button.title = labels[index];
    button.setAttribute('aria-label', labels[index]);
    button.addEventListener('click', () => desktop?.invoke(commands[index]));
  });
})();
