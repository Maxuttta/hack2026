import com.sun.source.tree.*;
import com.sun.source.util.JavacTask;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.TreePathScanner;
import com.sun.source.util.Trees;
import javax.tools.*;
import java.io.File;
import java.io.IOException;
import java.nio.file.Path;
import java.util.*;

/** Syntax analysis only: it parses source without executing it or resolving external dependencies. */
public final class JavaAnalyzer {
    private static final List<Map<String, Object>> findings = new ArrayList<>();
    private static final List<Map<String, Object>> outline = new ArrayList<>();
    private static final List<Map<String, Object>> graph = new ArrayList<>();
    private static final List<Map<String, Object>> refactors = new ArrayList<>();
    private static final List<Map<String, Object>> mainClasses = new ArrayList<>();
    private static Path sourceRoot;
    private static String relative(JavaFileObject source) {
        if (source == null) return "";
        Path path = Path.of(source.toUri()).toAbsolutePath().normalize();
        return sourceRoot.relativize(path).toString().replace(File.separatorChar, '/');
    }

    private static Map<String, Object> item(Object... values) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < values.length; i += 2) map.put((String) values[i], values[i + 1]);
        return map;
    }

    private static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof Number || value instanceof Boolean) return value.toString();
        if (value instanceof Map<?, ?> map) {
            List<String> parts = new ArrayList<>();
            for (var entry : map.entrySet()) parts.add(json(entry.getKey()) + ":" + json(entry.getValue()));
            return "{" + String.join(",", parts) + "}";
        }
        if (value instanceof Iterable<?> list) {
            List<String> parts = new ArrayList<>();
            for (Object entry : list) parts.add(json(entry));
            return "[" + String.join(",", parts) + "]";
        }
        StringBuilder out = new StringBuilder("\"");
        for (char ch : value.toString().toCharArray()) {
            switch (ch) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> { if (ch < 32) out.append(String.format("\\u%04x", (int) ch)); else out.append(ch); }
            }
        }
        return out.append('"').toString();
    }

    private static final class Scan extends TreePathScanner<Void, Void> {
        private final CompilationUnitTree unit;
        private final SourcePositions positions;
        private final String file;
        private final Deque<String> loops = new ArrayDeque<>();
        private final Deque<String> methods = new ArrayDeque<>();
        private final Deque<String> classes = new ArrayDeque<>();
        private final Deque<Map<String, Integer>> conditions = new ArrayDeque<>();

        Scan(CompilationUnitTree unit, SourcePositions positions, String file) {
            this.unit = unit;
            this.positions = positions;
            this.file = file;
        }

        private int line(Tree tree) {
            long start = positions.getStartPosition(unit, tree);
            return start < 0 ? 1 : (int) unit.getLineMap().getLineNumber(start);
        }

        private int endLine(Tree tree) {
            long end = positions.getEndPosition(unit, tree);
            return end < 0 ? line(tree) : (int) unit.getLineMap().getLineNumber(Math.max(0, end - 1));
        }

        private void outline(Tree tree, String kind, String name) {
            JavaAnalyzer.outline.add(item("file", file, "line", line(tree), "endLine", endLine(tree),
                    "kind", kind, "name", name, "depth", methods.size() + loops.size()));
        }

        private void finding(Tree tree, String severity, String title, String detail, String kind) {
            findings.add(item("file", file, "line", line(tree), "endLine", endLine(tree),
                    "severity", severity, "title", title, "detail", detail, "kind", kind));
        }

        private void graph(Tree tree, String kind) {
            long start = positions.getStartPosition(unit, tree);
            long end = positions.getEndPosition(unit, tree);
            if (start < 0 || end <= start || end > Integer.MAX_VALUE) return;
            JavaAnalyzer.graph.add(item("file", file, "line", line(tree), "endLine", endLine(tree),
                    "start", (int) start, "end", (int) end, "kind", kind,
                    "method", methods.isEmpty() ? "" : methods.peek()));
        }

        @Override public Void visitClass(ClassTree tree, Void unused) {
            outline(tree, "class", tree.getSimpleName().toString());
            classes.push(tree.getSimpleName().toString());
            try { return super.visitClass(tree, unused); }
            finally { classes.pop(); }
        }

        @Override public Void visitMethod(MethodTree tree, Void unused) {
            String name = tree.getName().toString();
            outline(tree, "method", name);
            if (classes.size() == 1 && name.equals("main") && tree.getReturnType() != null
                    && tree.getReturnType().toString().equals("void") && tree.getParameters().size() == 1
                    && tree.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.PUBLIC)
                    && tree.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.STATIC)) {
                String argument = tree.getParameters().get(0).getType().toString();
                if (argument.matches("(?:java\\.lang\\.)?String\\[\\]")
                        || argument.matches("(?:java\\.lang\\.)?String\\.\\.\\.")) {
                    String packageName = unit.getPackageName() == null ? "" : unit.getPackageName().toString();
                    String className = classes.peek();
                    mainClasses.add(item("file", file, "className",
                            packageName.isEmpty() ? className : packageName + "." + className));
                }
            }
            if (classes.size() == 1 && tree.getBody() != null && tree.getReturnType() != null
                    && tree.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.STATIC)
                    && !tree.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.SYNCHRONIZED)
                    && tree.getModifiers().getAnnotations().isEmpty() && tree.getTypeParameters().isEmpty()) {
                long start = positions.getStartPosition(unit, tree);
                long end = positions.getEndPosition(unit, tree);
                long bodyStart = positions.getStartPosition(unit, tree.getBody());
                long bodyEnd = positions.getEndPosition(unit, tree.getBody());
                if (start >= 0 && end > start && bodyStart > start && bodyEnd > bodyStart && end <= Integer.MAX_VALUE) {
                    refactors.add(item("file", file, "className", classes.peek(), "name", name,
                            "line", line(tree), "endLine", endLine(tree), "start", (int) start,
                            "end", (int) end, "bodyStart", (int) bodyStart, "bodyEnd", (int) bodyEnd,
                            "returnType", tree.getReturnType().toString(),
                            "parameters", tree.getParameters().stream().map(p -> p.getName().toString()).toList()));
                }
            }
            if (endLine(tree) - line(tree) + 1 > 40) {
                finding(tree, "warning", "Long method: " + (endLine(tree) - line(tree) + 1) + " lines",
                        "Consider extracting separate responsibilities into methods or classes.", "long-method");
            }
            methods.push(name);
            conditions.push(new HashMap<>());
            try { return super.visitMethod(tree, unused); }
            finally { methods.pop(); conditions.pop(); }
        }

        @Override public Void visitVariable(VariableTree tree, Void unused) {
            Tree parent = getCurrentPath().getParentPath() == null ? null : getCurrentPath().getParentPath().getLeaf();
            if (!(parent instanceof MethodTree) && !(parent instanceof LambdaExpressionTree)) graph(tree, "variable");
            return super.visitVariable(tree, unused);
        }

        @Override public Void visitExpressionStatement(ExpressionStatementTree tree, Void unused) {
            graph(tree, "expression");
            return super.visitExpressionStatement(tree, unused);
        }

        @Override public Void visitReturn(ReturnTree tree, Void unused) {
            graph(tree, "return");
            return super.visitReturn(tree, unused);
        }

        @Override public Void visitThrow(ThrowTree tree, Void unused) {
            graph(tree, "throw");
            return super.visitThrow(tree, unused);
        }

        @Override public Void visitBreak(BreakTree tree, Void unused) {
            graph(tree, "break");
            return super.visitBreak(tree, unused);
        }

        @Override public Void visitContinue(ContinueTree tree, Void unused) {
            graph(tree, "continue");
            return super.visitContinue(tree, unused);
        }

        @Override public Void visitAssert(AssertTree tree, Void unused) {
            graph(tree, "assert");
            return super.visitAssert(tree, unused);
        }

        private Void visitLoop(Tree tree, String expression, Runnable body) {
            graph(tree, "loop");
            outline(tree, "loop", tree.getKind().name().toLowerCase(Locale.ROOT));
            if (!loops.isEmpty()) {
                boolean same = !expression.isBlank() && loops.contains(expression);
                finding(tree, "warning", same ? "Repeated scan of the same collection: O(n²)" : "Nested loops: O(n·m)",
                        same ? "A Map or Set index may replace repeated collection searches. Check behavior with test inputs."
                             : "Complexity depends on both collection sizes. Review the nested scan and confirm changes with tests.",
                        same ? "quadratic" : "nested-loop");
            }
            loops.push(expression);
            try { body.run(); return null; }
            finally { loops.pop(); }
        }

        @Override public Void visitEnhancedForLoop(EnhancedForLoopTree tree, Void unused) {
            return visitLoop(tree, tree.getExpression().toString().replaceAll("\\s+", ""), () -> super.visitEnhancedForLoop(tree, unused));
        }

        @Override public Void visitForLoop(ForLoopTree tree, Void unused) {
            String expression = tree.getCondition() == null ? "" : tree.getCondition().toString().replaceAll("\\s+", "");
            return visitLoop(tree, expression, () -> super.visitForLoop(tree, unused));
        }

        @Override public Void visitWhileLoop(WhileLoopTree tree, Void unused) {
            return visitLoop(tree, tree.getCondition().toString().replaceAll("\\s+", ""), () -> super.visitWhileLoop(tree, unused));
        }

        @Override public Void visitDoWhileLoop(DoWhileLoopTree tree, Void unused) {
            return visitLoop(tree, tree.getCondition().toString().replaceAll("\\s+", ""), () -> super.visitDoWhileLoop(tree, unused));
        }

        @Override public Void visitIf(IfTree tree, Void unused) {
            graph(tree, "if");
            outline(tree, "if", tree.getCondition().toString());
            if (!conditions.isEmpty()) {
                String normalized = tree.getCondition().toString().replaceAll("\\s+", "");
                Integer first = conditions.peek().putIfAbsent(normalized, line(tree));
                if (first != null) finding(tree, "info", "Repeated condition",
                        "The same condition occurs on line " + first + ". Consider extracting a shared check.", "duplicate-condition");
            }
            return super.visitIf(tree, unused);
        }

        @Override public Void visitSwitch(SwitchTree tree, Void unused) {
            graph(tree, "switch");
            outline(tree, "switch", tree.getExpression().toString());
            return super.visitSwitch(tree, unused);
        }

        @Override public Void visitTry(TryTree tree, Void unused) {
            graph(tree, "try");
            outline(tree, "try", "try / catch");
            return super.visitTry(tree, unused);
        }
    }

    public static void main(String[] args) throws IOException {
        if (args.length < 2) throw new IllegalArgumentException("Source root and Java files are required");
        sourceRoot = Path.of(args[0]).toAbsolutePath().normalize();
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("Java compiler module is unavailable");
        DiagnosticCollector<JavaFileObject> errors = new DiagnosticCollector<>();
        try (StandardJavaFileManager manager = compiler.getStandardFileManager(errors, Locale.ROOT, null)) {
            List<File> paths = Arrays.stream(args).skip(1).map(File::new).toList();
            Iterable<? extends JavaFileObject> sources = manager.getJavaFileObjectsFromFiles(paths);
            JavacTask task = (JavacTask) compiler.getTask(null, manager, errors, List.of("-proc:none"), null, sources);
            Trees trees = Trees.instance(task);
            for (CompilationUnitTree unit : task.parse()) {
                String file = relative(unit.getSourceFile());
                new Scan(unit, trees.getSourcePositions(), file).scan(unit, null);
            }
        }
        List<Map<String, Object>> parseErrors = new ArrayList<>();
        for (Diagnostic<? extends JavaFileObject> error : errors.getDiagnostics()) {
            if (error.getKind() != Diagnostic.Kind.ERROR) continue;
            String file = relative(error.getSource());
            parseErrors.add(item("file", file, "line", Math.max(1, error.getLineNumber()), "severity", "error",
                    "title", error.getMessage(Locale.ENGLISH), "detail", "Java syntax error", "kind", "syntax"));
        }
        graph.sort(Comparator.comparing((Map<String, Object> entry) -> (String) entry.get("file"))
                .thenComparingInt(entry -> (int) entry.get("start")));
        System.out.println(json(item("findings", findings, "outline", outline, "graph", graph,
                "mainClasses", mainClasses,
                "refactors", refactors, "syntaxErrors", parseErrors)));
    }
}
