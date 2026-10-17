// use-windows.js — access the desk's window manager (registry + state + dispatch).
import { useContext } from 'react';
import { WindowContext } from './WindowManager.jsx';

export const useWindows = () => useContext(WindowContext);
