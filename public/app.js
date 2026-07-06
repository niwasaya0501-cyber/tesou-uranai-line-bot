(function () {
  const stepWorry = document.getElementById('step-worry');
  const stepPhoto = document.getElementById('step-photo');
  const stepLoading = document.getElementById('step-loading');
  const stepDone = document.getElementById('step-done');
  const stepError = document.getElementById('step-error');
  const selectedWorrySpan = document.getElementById('selected-worry');
  const photoInput = document.getElementById('photo-input');
  const preview = document.getElementById('preview');
  const submitBtn = document.getElementById('submit-btn');
  const closeBtn = document.getElementById('close-btn');
  const retryBtn = document.getElementById('retry-btn');
  const errorMessage = document.getElementById('error-message');

  const WORRY_LABELS = {
    love: '恋愛',
    work: '仕事',
    relationship: '人間関係',
    self: '自己分析',
    other: 'その他',
  };

  // Vercel FunctionsのリクエストボディはHTTP経由で数MBの上限があるため、
  // アップロード前にブラウザ側であらかじめ軽く縮小しておく
  // （最終的なOpenAIへのリサイズはサーバー側のsharpで行う）
  const MAX_DIMENSION = 1280;
  const JPEG_QUALITY = 0.8;

  let selectedWorry = null;
  let resizedDataUrl = null;
  let userId = null;

  function showStep(step) {
    [stepWorry, stepPhoto, stepLoading, stepDone, stepError].forEach((el) => {
      el.classList.add('hidden');
    });
    step.classList.remove('hidden');
  }

  function drawToCanvas(source, sourceWidth, sourceHeight) {
    let width = sourceWidth;
    let height = sourceHeight;
    if (width > height && width > MAX_DIMENSION) {
      height = Math.round((height * MAX_DIMENSION) / width);
      width = MAX_DIMENSION;
    } else if (height >= width && height > MAX_DIMENSION) {
      width = Math.round((width * MAX_DIMENSION) / height);
      height = MAX_DIMENSION;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(source, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  // iPhoneの縦向き写真などはEXIFに回転情報が入っており、
  // それを無視して描画すると横向き・逆さまの画像になってしまう。
  // createImageBitmapのimageOrientation: 'from-image'は、EXIFの向きを見て
  // 正しい向きのビットマップにデコードしてくれるため、これを優先的に使う。
  // 対応していない古いブラウザ向けにImage要素での読み込みをフォールバックとして残す。
  async function resizeImageFile(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        return drawToCanvas(bitmap, bitmap.width, bitmap.height);
      } catch (err) {
        console.warn('createImageBitmap failed, falling back to Image element:', err);
      }
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(drawToCanvas(img, img.width, img.height));
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function init() {
    try {
      const configRes = await fetch('/api/liff-config');
      const { liffId } = await configRes.json();

      await liff.init({ liffId });

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const profile = await liff.getProfile();
      userId = profile.userId;
    } catch (err) {
      console.error(err);
      errorMessage.textContent = '初期化に失敗しました。LINEアプリから開き直してください。';
      showStep(stepError);
    }
  }

  document.querySelectorAll('.worry-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedWorry = btn.dataset.worry;
      selectedWorrySpan.textContent = WORRY_LABELS[selectedWorry];
      showStep(stepPhoto);
    });
  });

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;

    resizedDataUrl = await resizeImageFile(file);
    preview.src = resizedDataUrl;
    preview.classList.remove('hidden');
    submitBtn.disabled = false;
  });

  submitBtn.addEventListener('click', async () => {
    if (!resizedDataUrl || !selectedWorry || !userId) return;

    showStep(stepLoading);

    try {
      const res = await fetch('/api/liff-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          worry: selectedWorry,
          imageBase64: resizedDataUrl,
        }),
      });

      if (!res.ok) {
        throw new Error(`submit failed: ${res.status}`);
      }

      showStep(stepDone);
    } catch (err) {
      console.error(err);
      errorMessage.textContent = 'エラーが発生しました。もう一度お試しください。';
      showStep(stepError);
    }
  });

  closeBtn.addEventListener('click', () => {
    liff.closeWindow();
  });

  retryBtn.addEventListener('click', () => {
    selectedWorry = null;
    resizedDataUrl = null;
    photoInput.value = '';
    preview.classList.add('hidden');
    submitBtn.disabled = true;
    showStep(stepWorry);
  });

  init();
})();
