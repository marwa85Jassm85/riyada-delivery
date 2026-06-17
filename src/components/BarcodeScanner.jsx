import { useEffect, useRef, useState } from 'react';

export default function BarcodeScanner({ onFound, onClose }) {
  const videoRef     = useRef(null);
  const streamRef    = useRef(null);
  const doneRef      = useRef(false);
  const rafRef       = useRef(null);
  const fileInputRef = useRef(null);
  const cameraOpenAt = useRef(0);

  const isSecure = window.isSecureContext ||
                   location.protocol === 'https:' ||
                   location.hostname === 'localhost' ||
                   location.hostname === '127.0.0.1';

  const [status,   setStatus]   = useState(isSecure ? 'loading' : 'capture');
  const [decoding, setDecoding] = useState(false);
  const [errMsg,   setErrMsg]   = useState('');

  // ── منع الرجوع عند فتح الكاميرا ──
  useEffect(() => {
    history.pushState({ bs: true }, '');

    function onPop(e) {
      if (Date.now() - cameraOpenAt.current < 8000) {
        history.pushState({ bs: true }, '');
      } else {
        onClose();
      }
    }
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (history.state?.bs) history.back();
    };
  }, []);

  // ── الكاميرا الحية (HTTPS فقط) ──
  useEffect(() => {
    if (!isSecure) return;
    startCamera();
    return cleanup;
  }, []);

  function cleanup() {
    doneRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('capture');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (doneRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const vid = videoRef.current;
      vid.srcObject = stream;
      vid.setAttribute('playsinline', 'true');
      await vid.play();
      setStatus('scanning');
      startScanning();
    } catch (e) {
      setStatus('capture');
    }
  }

  function beep() {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 1800;
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.18);
    } catch (_) {}
  }

  function handleFound(rawCode) {
    if (doneRef.current) return;
    doneRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (navigator.vibrate) navigator.vibrate(120);
    beep();
    setStatus('found');
    setTimeout(() => onFound(rawCode.trim()), 400);
  }

  // ── التقاط صورة وقراءة الباركود منها ──
  function onCaptureClick() {
    cameraOpenAt.current = Date.now();
  }

  async function handleFileCapture(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDecoding(true);
    setErrMsg('');
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      const url    = URL.createObjectURL(file);
      const result = await reader.decodeFromImageUrl(url);
      URL.revokeObjectURL(url);
      handleFound(result.getText());
    } catch (_) {
      setDecoding(false);
      setErrMsg('لم يُتعرف على الباركود — صوّره بوضوح وحاول مجدداً');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function startScanning() {
    if ('BarcodeDetector' in window) {
      let formats = ['code_128','code_39','code_93','codabar','ean_13','ean_8','upc_a','upc_e','itf','qr_code','data_matrix','aztec','pdf417'];
      try { const s = await BarcodeDetector.getSupportedFormats(); formats = formats.filter(f => s.includes(f)); } catch (_) {}
      const detector = new BarcodeDetector({ formats });
      const tick = async () => {
        if (doneRef.current || !videoRef.current) return;
        if (videoRef.current.readyState >= 2) {
          try { const codes = await detector.detect(videoRef.current); if (codes.length > 0) { handleFound(codes[0].rawValue); return; } } catch (_) {}
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    let reader;
    try { const { BrowserMultiFormatReader } = await import('@zxing/browser'); reader = new BrowserMultiFormatReader(); }
    catch (_) { setStatus('capture'); return; }

    const canvas = document.createElement('canvas');
    const tick = async () => {
      if (doneRef.current || !videoRef.current) return;
      const vid = videoRef.current;
      if (vid.readyState >= 2 && vid.videoWidth > 0) {
        canvas.width = vid.videoWidth; canvas.height = vid.videoHeight;
        canvas.getContext('2d').drawImage(vid, 0, 0);
        try { const r = await reader.decodeFromImageUrl(canvas.toDataURL('image/jpeg', 0.75)); handleFound(r.getText()); return; } catch (_) {}
      }
      await new Promise(r => setTimeout(r, 250));
      tick();
    };
    tick();
  }

  function handleOverlayClick() {
    if (Date.now() - cameraOpenAt.current < 2000) return;
    onClose();
  }

  return (
    <div className="bs-overlay" onClick={handleOverlayClick}>
      <div className="bs-modal" onClick={e => e.stopPropagation()}>

        <button className="bs-close" onClick={onClose} aria-label="إغلاق">✕</button>

        {/* ── وضع التقاط الصورة (HTTP) ── */}
        {(status === 'capture') && (
          <div className="bs-video-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
            <span style={{ fontSize: 56 }}>📷</span>
            <div style={{ textAlign: 'center', color: 'var(--text)', fontSize: 15, fontWeight: 600 }}>
              مسح الباركود
            </div>
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, maxWidth: 220 }}>
              اضغط الزر وصوّر الباركود — سيُقرأ فوراً بدون حفظ الصورة
            </div>

            {errMsg && (
              <div style={{ color: '#ef4444', fontSize: 13, textAlign: 'center', background: '#fef2f2', padding: '8px 14px', borderRadius: 8 }}>
                {errMsg}
              </div>
            )}

            <label
              className="btn-primary"
              style={{
                width: 200, marginTop: 8, fontSize: 16, padding: '12px 0',
                textAlign: 'center', cursor: decoding ? 'not-allowed' : 'pointer',
                opacity: decoding ? 0.6 : 1, display: 'block', borderRadius: 10,
                pointerEvents: decoding ? 'none' : 'auto',
              }}
            >
              {decoding ? '⏳ جاري القراءة...' : '📷 صوّر الباركود'}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => { onCaptureClick(); handleFileCapture(e); }}
              />
            </label>
          </div>
        )}

        {/* ── وضع الكاميرا الحية (HTTPS) ── */}
        {(status === 'loading' || status === 'scanning' || status === 'found') && (
          <div className="bs-video-wrap">
            <video ref={videoRef} className="bs-video" muted playsInline autoPlay />

            {status === 'loading' && (
              <div className="bs-center-msg">
                <div className="spinner bs-spinner" />
                <span>جاري تشغيل الكاميرا...</span>
              </div>
            )}

            {status === 'scanning' && (
              <div className="bs-reticle" aria-hidden="true">
                <span className="rc rc-tl" /><span className="rc rc-tr" />
                <span className="rc rc-bl" /><span className="rc rc-br" />
                <span className="bs-scan-line" />
              </div>
            )}

            {status === 'found' && (
              <div className="bs-found-flash">
                <span className="bs-found-icon">✅</span>
              </div>
            )}
          </div>
        )}

        <div className="bs-hint">
          {status === 'scanning' && '🎯 وجّه الكاميرا نحو الباركود — سيُقرأ تلقائياً'}
          {status === 'loading'  && 'جاري التحضير...'}
          {status === 'found'    && '✅ تم قراءة الباركود بنجاح!'}
          {status === 'capture'  && 'اضغط الزر وصوّر — الرقم يظهر فوراً'}
        </div>
      </div>
    </div>
  );
}
