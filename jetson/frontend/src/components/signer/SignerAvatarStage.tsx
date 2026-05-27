import type { ReactNode } from 'react';

type SignerAvatarStageProps = {
  children?: ReactNode;
};

export const SignerAvatarStage = ({ children }: SignerAvatarStageProps) => {
  return (
    <div className="border-signer-bg/60 bg-surface-screen/50 relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border">
      {children}
    </div>
  );
};
