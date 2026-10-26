import "./style.css";
import { mount } from "./counter.js";
import { label } from "./data.generated.js";

mount(document.querySelector("#counter"), label);
