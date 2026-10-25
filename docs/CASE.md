# Hackathon case coverage and demo

This page maps the supplied Axenix Java Blueprints brief to observable behavior. It separates a **worked example** from functionality for arbitrary Java projects.

| Brief | Demonstrable implementation | Boundary |
| --- | --- | --- |
| ~1,000-line Java monolith | **Load 1,000-Line Case Demo** opens a 1,000+ line console program; large-file acceptance loads a separate 1,006-line file | File size and project limits apply |
| Java ↔ visual model | Source and graph share a workspace; finding selection focuses source and card; supported card fields update source | Unrecognized constructs use exact-source AST cards |
| Diagnose and estimate Big O | Java AST exposes source ranges and repeated nested traversal with an `O(n²)` estimate | Big O is pattern-based |
| Explain a fix | Demo proposes a `HashMap` index and shows original location | Automatic indexing is demo-specific |
| Decompose the monolith | Proposal creates `Parser.java`, `Analyzer.java`, `Normalizer.java`, retains `DemoMonolith.java` as entry point | General extraction handles eligible static methods, not arbitrary decomposition |
| Preserve behavior | Compile both versions and compare selected stdin cases, exit status, stdout and stderr before applying | Finite cases are not a proof for all inputs |
| Mandatory Java scope | Bundled Java 17 compiler and standard modules execute console Java, collections and exceptions | Editor is not a full Java IDE or all-construct visual round-trip engine |
| Final demo | Open → analyze → graph → improve → behavior check → share | Use script below |
| Delivery | Windows `.exe`, source, build instructions, acceptance commands and architecture | Signing and publication depend on release setup |

## Operator script

Use the Windows app and keep **Tests** and **Analysis** visible during the demo.

1. **Start:** choose **File → Load 1,000-Line Case Demo**. Show the 1,000+ line source and project tree.
2. **Visualize:** click a loop card, move it, zoom, use Fit to content, and show its linked Java fragment. Edit a field in a disposable copy to demonstrate round-trip editing.
3. **Diagnose:** select **Analyze Project**. Open the nested-loop finding; identify source range and graph node. Explain `O(n²)` as repeated traversal of one collection.
4. **Improve:** select **Improve example**. The four-file candidate replaces repeated scans with a `HashMap` index. Show the generated `Parser`, `Analyzer` and `Normalizer` roles.
5. **Gate:** open **Behavior check**. Show the matching 8/8 configured cases and original version. Output order is preserved by iterating the original `items` list when printing.
6. **Regression:** change a printed separator in `Analyzer.java`; wait for the mismatch indicator. Use **Find Counterexample** to show a concrete input. Undo the edit.
7. **Collaborate:** click **Share**, open the same project with a second client, move a card or edit code and show the peer update. A viewer link demonstrates read-only access.

## Evidence commands

Run after `pnpm dist` has produced `dist/win-unpacked/Java Blueprints.exe`:

| Command | Checks |
| --- | --- |
| `pnpm smoke` | AST diagnosis; demo transformation; 8 matching cases; automatic mismatch; counterexample |
| `pnpm acceptance:large` | 1,006-line file; 1,000+ graph nodes; AST; execution; graph edit; undo/redo; guarded extraction |
| `pnpm acceptance:collaboration` | 3 WebSocket clients; concurrent text convergence; viewer rejection; disk persistence after restart |
| `pnpm acceptance:collaboration-desktop` | Desktop client and local collaboration room integration |

Save JSON output with the final release if organizers request test results. Never publish private room links, access keys or server credentials.

## Case scope

The mandatory language and standard-library areas in the supplied slides are ordinary Java 17 programs: user classes/interfaces, primitives and arrays, control flow, methods/constructors/fields, `java.lang`, console I/O including Cyrillic encodings, `java.util` collections and helpers, and checked/unchecked exceptions. Generic types, records/enums, lambdas and streams are bonus capabilities. Concurrency, reflection, file operations, networking and time APIs are outside the evaluation scope. The bundled JDK can compile more Java than the graph can represent structurally; use AST cards or source view for unsupported visual edits.
