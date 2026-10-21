import { config } from "./config.js";
import { createApp } from "./app.js";

createApp().listen(config.port, () => console.log(`Logger API listening on :${config.port}`));
