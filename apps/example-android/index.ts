import { registerRootComponent } from "expo";

import App from "./App";

// registerRootComponent wraps AppRegistry.registerComponent("main", () => App)
// and sets up the environment the same way for a dev build and a release
// build.
registerRootComponent(App);
