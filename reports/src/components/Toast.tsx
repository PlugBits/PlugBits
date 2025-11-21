import { useEffect } from 'react';

type ToastProps = {
  type: 'success' | 'error' | 'info';
  message: string;
  onClose?: () => void;
  duration?: number;
  subMessage?: string;
};

const Toast = ({ type, message, subMessage, onClose, duration = 4000 }: ToastProps) => {
  useEffect(() => {
    if (!duration) return undefined;
    const handle = setTimeout(() => onClose?.(), duration);
    return () => clearTimeout(handle);
  }, [duration, onClose]);

  return (
    <div className={`toast toast-${type}`}>
      <div>
        <div>{message}</div>
        {subMessage && <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>{subMessage}</div>}
      </div>
      {onClose && (
        <button className="toast-close" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  );
};

export default Toast;
