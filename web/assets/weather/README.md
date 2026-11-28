# Weather V4 / weather-demo integration

Drop this directory into `web/assets/weather/` and replace `web/weather-demo.html`.
The existing `web/weather/weather.mjs` continues to provide weather lookup, mapping,
cache, and local defaults. This demo imports only the new local visual engine; no change
to the rest of the app, weather data, sync, or CI is required.

## Assets

The 16 numbered folders hold the original 1440×3120 PNG layers, unchanged, and
their original `layer_config.json` metadata from WEATHER_V3_DIRECT_LAYERS.zip.
The 9 original textures are in `textures/`. The reference composites and editable
OpenRaster stacks do not need to be shipped to the web client. Original editable
SVG references in the metadata are provenance from the source archive, not runtime
dependencies. The L75 heat refraction is code-driven and has no PNG.

The renderer loads only a selected state's layers. Native cloud/volume textures
are positioned using the source configuration to avoid hard moving edges. The
full original source rectangle is displayed, not cover-cropped; artwork is mapped
to a screen-sized framebuffer, while the archived PNG files keep their original
resolution and exact bytes. Texture placement itself retains the authored
off-canvas positions. On wider screens the portrait scene sits over a matching
sky gradient. No PNG is recompressed or resampled on disk.

## Signature effects

- Sunny: breathing sunlight and soft optical reflections.
- Night: individual star scintillation and a recurring meteor with a luminous tail.
- Partly cloudy: parallax of the cumulus and changing sunlight/soft shadow.
- Overcast: layered rolling stratus and broad moving cloud shade.
- Fog: near/far textured fog passes; changing visibility.
- Drizzle: fine vertical rain, little surface rings.
- Downpour: slanted rain sheets, wind gusts and impact rings/splash droplets.
- Thunderstorm: connected, branching lightning channel with local illumination and
  a paired pulse (first strike about two seconds after entering the scene).
- Snow: drifting crystal sprites and a progressively accumulating snow edge.
- Blizzard: fast near-horizontal snow, gust bands and whiteout.
- Hail: faceted ice chunks, shadows, gravity and diminishing rebounds.
- Freezing rain: bright icy rain, growing edge frost and glinting runnels.
- Wind: fast parallax and coherent curved wind gusts.
- Dust: ochre volume drift, sand grains and warm low-visibility haze.
- Heat: animated scene refraction using display-resolution strips; UI stays intact.
- Cyclone: the painted cloud spiral rotates continuously around its eye, with
  wind-swept rain underneath.

## Preview and integration

Serve the repository's `web/` directory over a local HTTP server or GitHub Pages.
Open `weather-demo.html?s=thunderstorm` (the IDs correspond to the numbered folders).
The selector updates this URL parameter. Location, refresh and reduced-motion
behavior remain available. Pause resets the scene to its resting layer positions.
The engine stops ticking in a hidden document and tears down replaced scenes.
Device pixel ratio and framebuffer area are bounded; sustained slow frames reduce
only display resolution. Heavy effects target 30fps, lighter effects up to 60fps.

Verified: source PNG byte identity, PNG dimensions, metadata references used
at runtime, JS syntax and all 16 states over simulated frames in JavaScriptCore;
pause/resume, rapid selection, and scene disposal. Browser/real-device FPS and
visual acceptance must still be checked on iOS and Android: the build environment
blocked local browser/server testing.
