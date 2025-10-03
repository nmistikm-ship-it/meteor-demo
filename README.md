# Meteor Impact Demo

This is a small interactive web demo that simulates meteors impacting a stylized Earth using Three.js. It was created as part of a NASA / Space Apps style project.

Features
- 3D Earth rendered with Three.js with lighting and an optional high-resolution texture.
- Fire meteors from the camera toward the scene using an on-screen cursor or the UI.
- Toggle realistic physics (simple gravity/energy calculation) and view impact counters.
- Fetch a list of known near-Earth objects (NEOs) from the NASA API and spawn real asteroid data into the scene.

Quick start (Windows)

1. Install dependencies (requires Node.js and npm)

	Open PowerShell in the project folder and run:

	npm install

2. Start the development server using the bundled `start.bat` (recommended on Windows) or `run.sh` on macOS / Linux

	The `start.bat` script is a convenience wrapper that:
	- Accepts an optional port argument (defaults to 5173):
	  .\start.bat 3000
	- Starts Vite in the background and redirects its output to `vite.log` in the project folder.
	- Polls the local server until it responds (up to ~60 seconds).
	- Automatically opens your default browser to `http://localhost:<port>` when the server is ready (or after the timeout).

	To use it, double-click `start.bat` or run in PowerShell:

	.\start.bat

		On macOS or Linux, make the script executable and run:

		chmod +x run.sh
		./run.sh

3. Manually (alternative)

	If you prefer to run Vite directly (for debugging) use:

	npx vite --port 5173

	This will print the dev server URL directly in the terminal; you can then open the browser manually.

Controls
- Simulation Speed: Adjust global simulation time scaling.
- Meteor Speed: Set the initial launch speed of fired meteors.
- Fire / Space: Launch a meteor from the camera toward the cursor.
- Pause / Reset: Pause or reset the simulation.
- Toggle Aiming: Show/hide the aiming guide.
- Load High-res Earth Texture or upload your own image for a better look.

NASA API (optional)
- The UI contains a field for a NASA API key and a button to fetch a list of near-Earth objects. If you supply a key the demo will request data from the public NASA NEO APIs and populate the asteroid selector.
- If you don't have a key, you can still use the demo — the asteroid fetch feature will remain disabled or limited by CORS/remote restrictions.

Files of interest
- `index.html` — main page and UI
- `main.js` — demo logic and Three.js scene
- `styles.css` — basic UI styling
- `start.bat` — convenience script that runs the Vite dev server

Notes and troubleshooting
- This project uses the `three` and `vite` packages. If you see rendering errors, ensure your browser supports WebGL and that dependencies are installed.
- If the NASA API requests fail due to CORS or missing key, try fetching data from the command line or obtaining a free key at https://api.nasa.gov.

License & Credits
- MIT-style educational demo. See `LICENSE` for details.
- Built with Three.js. Some textures and data may be taken from public NASA or Blue Marble resources — respect their terms when redistributing.

Contributing
- Small improvements, bug fixes, or texture additions are welcome via pull requests.

Enjoy the demo!

Run processes (how to start the project)
--------------------------------------

This project includes three convenient ways to start the development server. Use whichever fits your platform or workflow.

1) Windows: `start.bat` (background, auto-open)

	- Usage: `.\\start.bat [port]`
	- Defaults to port 5173 if none provided.
	- Behavior: launches `npm run start:open` in a background cmd process, redirects Vite output to `vite.log`, polls the server until it responds (up to ~60 seconds), and opens your default browser to `http://localhost:<port>` when ready. If the server doesn't respond in time, the script prints `vite.log` and still attempts to open the browser.

2) Cross-platform: npm scripts

	- Install dependencies: `npm install`
	- Start dev server (no auto-open): `npm run start` (runs `vite`)
	- Start dev server and open browser: `npm run start:open` (runs `vite --open`)
	- These scripts are the simplest cross-platform way to run and are useful when you want to see Vite output directly in the terminal.

3) macOS / Linux: `run.sh` (background, auto-open)

	- Usage: `./run.sh [port]` (make executable first: `chmod +x run.sh`)
	- Defaults to port 5173.
	- Behavior: runs `npm run start:open` in the background, redirects output to `vite.log`, polls the server until it's reachable (60s timeout), and opens your browser using `xdg-open` (Linux) or `open` (macOS).

Logs and troubleshooting

- All the background-starting helpers write Vite logs to `vite.log` in the project root. If the server doesn't start, inspect that file for errors.
- If automatic browser opening fails on Linux, ensure `xdg-open` (xdg-utils) is installed. On macOS `open` is used.
- If you prefer to debug Vite itself, run `npx vite --port <port>` directly and review the terminal output.

If you'd like, I will keep this section updated every time we change start scripts or add new run flows. Mark this task done if this meets your needs.

## Changelog

Recent automated changes will be appended here.

High-resolution textures (USGS)
--------------------------------

The UI's "Load High-res Earth Texture" button will prompt you for a texture URL. Paste a USGS-provided texture URL (or another remote texture) and the app will try to load it first. If it fails (CORS/network), the app falls back to the built-in defaults.

Note: USGS API integration is not implemented yet — you'll provide details for that later. For now, the URL prompt lets you point the app at any public texture you have access to.
