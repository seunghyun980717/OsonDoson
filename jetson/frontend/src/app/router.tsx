import { createBrowserRouter } from 'react-router-dom';

import { HearingPage } from '../pages/HearingPage';
import { MainPage } from '../pages/MainPage';
import { SignerPage } from '../pages/SignerPage';

export const router = createBrowserRouter([
  { path: '/', element: <MainPage /> },
  { path: '/hearing', element: <HearingPage /> },
  { path: '/signer', element: <SignerPage /> },
]);
