// Browser entry. Two ways to get data:
//   - static artifact: data is baked in as window.__DATA__ (build-frontend).
//   - served app: no baked data -> fetch the live snapshot from the API.
import { render } from "./app.js";

if (window.__DATA__) {
	render(document.body, window.__DATA__);
} else {
	fetch("/api/snapshot")
		.then((response) => { return response.json(); })
		.then((data) => { render(document.body, data); })
		.catch((error) => {
			document.body.textContent = "could not load /api/snapshot — is the convergence app running? (" + error.message + ")";
		});
}
