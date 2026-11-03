# Bundled data

`godot-api.json.gz` is built from the class reference of
[Godot Engine](https://github.com/godotengine/godot) 4.7.2-stable
(`doc/classes`, `modules/*/doc_classes`, `platform/*/doc_classes`) and from the
official Godot 3 to 4 rename tables (`editor/project_upgrade/renames_map_3_to_4.cpp`).

Rebuild it from a Godot source checkout at a release tag:

```sh
npm run build:api -- /path/to/godot 4.7.2-stable <commit>
```

`lessons.json` holds the lessons from real Godot 4 projects that `godot_lessons` and `godotwright lessons` answer
from: an id, a topic, the lesson, symptom, cause, fix, how to test, the rules that check it, Godot message fragments
and archetypes. They are anonymous: no code, names, paths or numbers that point to a project or a person, and
`test/lessons.test.ts` runs every one through the same scrubber that local lessons go through. Propose new ones from
`godotwright lessons export`.

`api-removed.json` lists what Godot 4.0 to 4.6 had and Godot 4.7 does not, with the last release that had it.
It comes from the `extension_api.json` of each release (the `godot-4.x-stable` branches of
[godot-cpp](https://github.com/godotengine/godot-cpp) for 4.0 to 4.5, and `--dump-extension-api` of Godot 4.6.2 and
4.7.2, since godot-cpp has no 4.6 or 4.7 file), and every entry was then tried in a real Godot 4.7.2: names Godot
still accepts for old projects are listed apart under `compat`, and internal classes that still exist are left out.
Rebuild it with:

```sh
npm run build
cd /folder && godot-4.6 --headless --dump-extension-api && mv extension_api.json extension_api-4.6.json  # same for 4.7
GODOT=/path/to/godot node scripts/build-api-history.mjs /folder/with/extension_api-4.0.json...extension_api-4.7.json
```

`api-changes.json` is written by hand from the official upgrade guides (`upgrading_to_godot_4.6.rst` and
`upgrading_to_godot_4.7.rst` in [godot-docs](https://github.com/godotengine/godot-docs)): changes that still compile
but behave differently, changed defaults, and signature changes that matter to GDScript. Each entry says how it was
checked (`verified`): by running the same script in Godot 4.6.2 and 4.7.2, or against the 4.7.2 class reference. Changes
the guide lists as GDScript compatible (a parameter that became `StringName` or `float`) are left out: they only
matter to C#. `godot_api` shows the entry under the member, and the review rules in `src/review/checks/version.ts` use
the ids.

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
