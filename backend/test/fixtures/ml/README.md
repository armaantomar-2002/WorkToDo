# ML contract fixtures

Generated once from the real `worktodo_service` engine (read-only). Not hand-edited.

- `scenario-*.json`: `publicRequest` (Node API), `pythonRequest` (exact payload Node must send), `pythonResponse` (real engine output), `publicResponse` (expected Node response). camelCase files were converted by independent code, not by the Node mapper.
- `python-422-samples.json`: real Python validation-error bodies used by the error-mapping tests.
- Scores are compared exactly in fake-server tests; live tests compare `mlScore` with a 1e-9 tolerance.
