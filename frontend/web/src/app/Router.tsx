import { createBrowserRouter, Navigate } from 'react-router-dom';

import { FlowPage } from '@/pages/FlowPage';
import { MainPage } from '@/pages/MainPage';

export const router = createBrowserRouter([
  { path: '/', element: <MainPage /> },
  // android의 RootStack.Flow + entry param 미러. URL: /flow?entry=hearing | /flow?entry=signer
  { path: '/flow', element: <FlowPage /> },
  // 알 수 없는 경로는 메인으로
  { path: '*', element: <Navigate to="/" replace /> },
]);
