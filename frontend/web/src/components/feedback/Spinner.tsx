// 로딩 스피너. android의 Spinner 컴포넌트와 동일한 톤(hearing/signer).
type SpinnerProps = {
  tone?: 'hearing' | 'signer' | 'neutral';
  size?: number;
};

const toneClass: Record<'hearing' | 'signer' | 'neutral', string> = {
  hearing: 'border-hearing-action',
  signer: 'border-signer-action',
  neutral: 'border-neutral-400',
};

export const Spinner = ({ tone = 'neutral', size = 48 }: SpinnerProps) => {
  return (
    <span
      role="status"
      aria-label="로딩 중"
      className={`inline-block animate-spin rounded-full border-4 border-t-transparent ${toneClass[tone]}`}
      style={{ width: size, height: size }}
    />
  );
};
