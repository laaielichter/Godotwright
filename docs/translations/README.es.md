# Traducción del README de Godotwright

Esta es una traducción al español de la parte inicial del [README.md](../../README.md) en inglés, para la versión de
Godotwright **0.8.0**. El README en inglés sigue siendo la fuente de verdad.

Los agentes de código aprendieron Godot con años de tutoriales de Godot 3. Escriben `yield`, `export var` y
`KinematicBody2D`, inventan métodos y conectan señales a nodos que no están en la escena. Godotwright es el control entre
el agente y tu proyecto: la API real de Godot 4.7 sin conexión, una reseña con puntuación de cada script, ejecuciones de
Godot sin interfaz y ediciones seguras. Funciona desde archivos, así que no necesita un editor abierto, y funciona bien
junto a un servidor MCP que maneja el editor.

## Sin y con

| Tu agente... | Por su cuenta | Con Godotwright |
| --- | --- | --- |
| escribe GDScript | `yield`, `export var`, `KinematicBody2D`: hábitos de Godot 3 | cada línea marcada con el arreglo de Godot 4; `migrate` reescribe la parte mecánica |
| llama a un método del motor | adivina un nombre de memoria | lo busca en la referencia de clases de Godot 4.7 incluida |
| renombra una señal o mueve un archivo | rompe las conexiones de la escena y los archivos `.uid` | `rename` cambia código, escenas, conexiones y archivos `.uid` juntos, primero sin aplicar los cambios |
| dice "funciona" | sin ejecutar nada | `check`, `test` y `play` lo ejecutan sin interfaz e informan `file:line` |
| escribe un shader | `hint_albedo`, `SCREEN_TEXTURE`, `ALBEDO` en un shader 2D | revisado contra las tablas de shaders de Godot 4.7 y compilado sin interfaz; `fix` renombra los nombres de Godot 3 |
| copia una escena o escribe un `.tscn` a mano | uids duplicados o inválidos, ediciones que Godot descarta al siguiente guardado | detectado solo desde los archivos; `fix` repara los uids entre archivos, con deshacer |
| dice que la compilación funciona | nunca la exporta | `export run` exporta sin interfaz, lee el `.pck`, lo comprueba contra lo que carga el juego y lo ejecuta; también paquetes de parche |
| cambia el HUD | no puede ver qué cambió | líneas base de capturas con diferencia de píxeles, en escenarios y en CI |
| necesita un modelo 3D | necesita Blender | `model build` crea un `.glb` limpio a partir de uno de los 59 tipos y luego lo analiza |
| abre un pull request | nadie revisa la parte de Godot | una GitHub Action publica un recibo: review, check y tests |

## Inicio rápido

**1. Revisa tu juego.** Nada que instalar:

```sh
npx -y godotwright review ~/games/my-game
```

Recibes una puntuación de 0 a 100 para api, performance, quality y structure, y cada hallazgo como
`res://player.gd:12: error [rule] message` con el arreglo de Godot 4. No hace falta instalar Godot.

**2. Entrégalo a tu agente.** En Claude Code:

```text
/plugin install godotwright --marketplace laaielichter/Godotwright
```

**3. Pide algo.** Por ejemplo: *"Revisa el proyecto y arregla lo que encuentre Godotwright."* Cada archivo de Godot
que edita Claude ahora se revisa justo después de la edición, y sus errores vuelven directamente a Claude.

## Instalar en tu agente

| Cliente | Cómo |
| --- | --- |
| **Claude Code** | `/plugin install godotwright --marketplace laaielichter/Godotwright` (servidor MCP, hooks, once skills, ocho subagentes) |
| **Claude Desktop** | Descarga [`godotwright.mcpb`](https://github.com/laaielichter/Godotwright/releases/latest/download/godotwright.mcpb) y ábrelo |
| **Cursor** | [Añadir a Cursor](https://laaielichter.github.io/Godotwright/install.html#cursor) (un clic) |
| **VS Code** (Copilot) | [Instalar en VS Code](https://laaielichter.github.io/Godotwright/install.html#vscode) (un clic) |
| **Codex** | `codex mcp add godotwright -- npx -y godotwright mcp --tier premium` |
| **Gemini CLI** | `gemini extensions install https://github.com/laaielichter/Godotwright` |
| **opencode** | [Añadir a `opencode.json`](https://laaielichter.github.io/Godotwright/install.html#opencode) |
| **Windsurf, Zed, otros** | [JSON para tu cliente](https://laaielichter.github.io/Godotwright/install.html#other) |

Ejecuta el agente desde la carpeta del proyecto de Godot, o pasa `--project <path>`. `--tier premium` da detalle
completo para modelos grandes; `--tier cheap` (el predeterminado) da salida breve e instrucciones paso a paso para los
pequeños. Requiere Node.js 22.12+.
