type PeerStatusBadgeProps = {
  peerConnected: boolean;
  peerLabel: string; // 청인이 보는 농인 = "고객", 농인이 보는 청인 = "직원"
};

export const PeerStatusBadge = ({ peerConnected, peerLabel }: PeerStatusBadgeProps) => {
  return (
    <span
      className={`rounded-pill inline-flex items-center gap-2 px-3 py-1 text-sm font-medium whitespace-nowrap ${
        peerConnected
          ? 'bg-status-info-bg text-status-info-text'
          : 'bg-neutral-100 text-text-muted'
      }`}
    >
      <span
        className={`rounded-pill h-2 w-2 ${
          peerConnected
            ? 'bg-status-online ring-status-online/20 ring-2'
            : 'bg-neutral-300'
        }`}
      />
      {peerLabel} {peerConnected ? '연결됨' : '대기 중'}
    </span>
  );
};
