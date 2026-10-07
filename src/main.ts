import { mount } from 'svelte';
import './ui/styles/global.css';
import App from './ui/App.svelte';

export default mount(App, { target: document.getElementById('app')! });
