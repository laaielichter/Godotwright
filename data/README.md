# Bundled data

`godot-api.json.gz` is built from the class reference of
[Godot Engine](https://github.com/godotengine/godot) 4.7.2-stable
(`doc/classes`, `modules/*/doc_classes`, `platform/*/doc_classes`) and from the
official Godot 3 to 4 rename tables (`editor/project_upgrade/renames_map_3_to_4.cpp`).

Rebuild it from a Godot source checkout at a release tag:

```sh
npm run build:api -- /path/to/godot 4.7.2-stable <commit>
```

The Godot class reference and rename tables are MIT licensed:

> Copyright (c) 2014-present Godot Engine contributors (see AUTHORS.md in the Godot repository).
> Copyright (c) 2007-2014 Juan Linietsky, Ariel Manzur.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of
> this software and associated documentation files (the "Software"), to deal in the
> Software without restriction, including without limitation the rights to use,
> copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
> Software, and to permit persons to whom the Software is furnished to do so,
> subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
> FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
> COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
> AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
> WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
