import { createHubApp } from "../apps/hub/src/app.js";
import { Store } from "../apps/hub/src/store.js";

const store = new Store({ gcIntervalMs: null });

export default createHubApp(store);
