import { mount } from 'svelte';
import './ui/styles/global.css';
import App from './ui/App.svelte';
import { theme } from './ui/theme.svelte';

theme.start();

export default mount(App, { target: document.getElementById('app')! });
