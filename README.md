# Meteor Impact Demo

This is a small interactive web demo that simulates meteors impacting a stylized Earth using Three.js. It was created as part of a NASA / Space Apps style project.

Features
- 3D Earth rendered with Three.js with lighting and an optional high-resolution texture.
- Fire meteors from the camera toward the scene using an on-screen cursor or the UI.
- Toggle realistic physics (simple gravity/energy calculation) and view impact counters.
- Fetch a list of known near-Earth objects (NEOs) from the NASA API and spawn real asteroid data into the scene.

Quick start (Windows)
1. Install dependencies (requires Node.js and npm):

	Open PowerShell in the project folder and run:

	npm install

2. Start the development server (the repository includes a small `start.bat` that runs Vite):

	Double-click `start.bat` or run in PowerShell:

	.\start.bat

3. Open the demo in a browser at the address printed by Vite (usually http://localhost:5173).

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
