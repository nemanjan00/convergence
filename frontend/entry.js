// Browser entry: render the app with data embedded on the page as window.__DATA__.
import { render } from "./app.js";

render(document.body, window.__DATA__);
