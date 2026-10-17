// Saved RECORD windows keep resolving; both old entry points now open one record.
import { useEffect } from 'react';
import { useWindows } from '../windowing/use-windows.js';
import { sheetApp } from './SheetApp.jsx';

const LegacyRecordBody = () => {
  const { dispatch } = useWindows();
  useEffect(() => {
    dispatch({ type: 'OPEN', id: 'sheet' });
    dispatch({ type: 'CLOSE', id: 'stats' });
  }, [dispatch]);
  return null;
};

export const statsApp = {
  ...sheetApp,
  appliesTo: 'all',
  dock: false,
  launcher: false,
  Body: LegacyRecordBody,
  storageKey: 'stats',
};
