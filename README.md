# tripo-engine

Server-side client for Tripo API v3. The key stays in `TRIPO_API_KEY`. It is not a browser key and it does not go in a Spawn world.

Base: `https://openapi.tripo3d.ai/v3`
Auth: `Authorization: Bearer ${TRIPO_API_KEY}`

## Image to multiview

`POST /generation/image-to-multiview`

```json
{ "input": "https://example.com/character.png" }
```

`input` is one string: a public PNG, JPEG, or WebP URL, or a `file_token` from `POST /files` (JPEG or PNG, 20 MB).

Create returns `{ code: 0, data: { task_id } }`. Poll `GET /tasks/{task_id}` every 2 seconds, up to 5 minutes.

Success output:

```json
{
  "generate_multiview_image": {
    "front_view_url": "https://cdn.tripo3d.ai/front.png",
    "left_view_url": "https://cdn.tripo3d.ai/left.png",
    "back_view_url": "https://cdn.tripo3d.ai/back.png",
    "right_view_url": "https://cdn.tripo3d.ai/right.png"
  }
}
```

## Texture

Model page: Tripo Texture `v3.5-20260815`. Endpoint `POST /models/texture`.

Input is one string: a generation `task_id`, a `file_token`, or a public `GLB` / `GLTF` / `FBX` / `OBJ` / `STL` URL (150 MB). Output on success is `output.model_url` plus `output.rendered_image_url`. Task type is `texture_model`.

The package pins `model: "v3.5-20260815"` and `delight: true` (clean base color for a game light). Pass `delight: false` to keep stylized lighting. `v3.0-20250812` is sent without `delight` unless you set it, so the service keeps delight off. `v2.5-20250123` is for v2.5 geometry. `texture_quality: "fast"` on v2.5 is refused here; the API returns `1004`.

`texture_quality` is `fast` (10 credits), `standard` (10), `detailed` (20), or `extreme` (30, 8K). `pbr` defaults true. Model processing allows 5 parallel tasks.

`texture_prompt` is optional. Use one of these, never more than one:

- `text`, optionally with `style_image` as `{ url }` or `{ file_token }`
- `image`, a single file token or URL
- `images`, view-key objects (`front` required, at least two of front/left/back/right) or four positional slots `[front, left, back, right]` with `null` for a missing view

A bare retexture sends no `texture_prompt`.

## Model from the same task

`POST /generation/multiview-to-model` accepts that task alone:

```json
{ "inputs": [{ "task_id": "<image_to_multiview task id>" }], "model": "v3.1-20260211" }
```

The source task must be `success` and type `image_to_multiview`.

## Three.js path

Use the official `tripo` CLI. This package only builds its arguments and refuses to put a key on the command line. Dry-run is the default and spends nothing.

Text, one image, or 2–4 views become a GLB:

- model `P2-20260801` (the CLI default; do not swap it unless asked)
- `texture=true`, `texture_quality=standard`, `face_limit=20000`, `pbr=true`
- no `game-mobile` chain (that converts to FBX) and no `ar-web` chain (that adds USDZ)

```bash
node src/cli.js plan-text "a wooden crate"
node src/cli.js plan-image ./concept.png
```

A paid run is the same `tripo make` argv without `--dry-run`, after the plan is accepted. Generation estimate for this plan is 110 credits. Texture and stylize passes are extra and are not included in that estimate.

## Textures and stylization

`tripo model texture` runs after a model task exists. `--then` cannot carry a `texture_prompt` object, so stylization is its own command.

| Style | delight | alignment | use |
|---|---|---|---|
| realistic | true | geometry | clean base color under game lights |
| stylized | false | original_image | keep painted light; guide with `text` or one `image` |

`text` may include `style_image`. `text` and `image` are never sent together. `style_image` is never sent alone.

After the GLB is on disk, scale it with `grudge-convert` `glb2glb` (`--height 1.8` for a human). Do not `scale.set(100)` in Three.js. Heroes stay on the Toon play kit. This pipeline makes props and meshes, and it does not replace `loadRaceKit`.

## Key

`tripo login` writes the key to `C:\Users\nugye\.tripo\config.json`. `TRIPO_API_KEY` overrides that file. Neither value goes in git, in a Spawn world, or in chat.
