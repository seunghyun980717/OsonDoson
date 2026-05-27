import { useContext } from 'react';

import { HearingSessionContext } from '@/contexts/HearingSessionContext';

export const useHearingSession = () => {
    const ctx = useContext(HearingSessionContext);
    if (!ctx) {
        throw new Error('useHearingSession은 HearingSessionProvider 내부에서 사용되어야 함.');
    }
    return ctx;
}