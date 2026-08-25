import { mount } from "svelte";
import App from "./App.svelte";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./app.scss";

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
