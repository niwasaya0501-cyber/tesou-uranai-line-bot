(function () {
  const stepWorry = document.getElementById('step-worry');
  const stepPhoto = document.getElementById('step-photo');
  const stepLoading = document.getElementById('step-loading');
  const stepResult = document.getElementById('step-result');
  const stepError = document.getElementById('step-error');
  const stepUnreadable = document.getElementById('step-unreadable');
  const selectedWorrySpan = document.getElementById('selected-worry');
  const worryButtons = document.getElementById('worry-buttons');
  const otherWorryForm = document.getElementById('other-worry-form');
  const otherWorryText = document.getElementById('other-worry-text');
  const otherWorrySubmit = document.getElementById('other-worry-submit');
  const otherWorryBack = document.getElementById('other-worry-back');
  const photoInput1Camera = document.getElementById('photo-input-1-camera');
  const photoInput1Gallery = document.getElementById('photo-input-1-gallery');
  const photoInput2Camera = document.getElementById('photo-input-2-camera');
  const photoInput2Gallery = document.getElementById('photo-input-2-gallery');
  const photoCameraBtn1 = document.getElementById('photo-camera-btn-1');
  const photoCameraBtn2 = document.getElementById('photo-camera-btn-2');
  const cameraModal = document.getElementById('camera-modal');
  const cameraVideo = document.getElementById('camera-video');
  const cameraShutter = document.getElementById('camera-shutter');
  const cameraCancel = document.getElementById('camera-cancel');
  const preview1 = document.getElementById('preview-1');
  const preview2 = document.getElementById('preview-2');
  const submitBtn = document.getElementById('submit-btn');
  const retryBtn = document.getElementById('retry-btn');
  const rereadBtn = document.getElementById('reread-btn');
  const errorMessage = document.getElementById('error-message');
  const pageTitle = document.getElementById('page-title');
  const readingTextEl = document.getElementById('reading-text');
  const chatLog = document.getElementById('chat-log');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const chatInputRow = document.getElementById('chat-input-row');
  const chatLimitActions = document.getElementById('chat-limit-actions');
  const chatDeleteBtn = document.getElementById('chat-delete-btn');
  const chatKeepBtn = document.getElementById('chat-keep-btn');
  const chatClearBtn = document.getElementById('chat-clear-btn');
  const newReadingBtn = document.getElementById('new-reading-btn');

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
  let selectedWorryText = null;
  let resizedDataUrl1 = null;
  let resizedDataUrl2 = null;
  let cameraStream = null;
  let activeCameraSlot = null;

  // LINEのuserIdの代わりに、このブラウザだけで使う匿名IDを作ってlocalStorageに保存する。
  // 同じ端末・ブラウザから再度開いたときに、同じ鑑定結果・やりとりを続けられるようにするため
  function getOrCreateSessionId() {
    const STORAGE_KEY = 'palmSessionId';
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id =
        (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  }

  const sessionId = getOrCreateSessionId();

  function showStep(step) {
    [stepWorry, stepPhoto, stepLoading, stepResult, stepError, stepUnreadable].forEach((el) => {
      el.classList.add('hidden');
    });
    step.classList.remove('hidden');

    // 鑑定中画面はカード内に独自のタイトルがあるため、上の見出しは重複するので隠す
    pageTitle.classList.toggle('hidden', step === stepLoading);
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

  document.querySelectorAll('.worry-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.worry === 'other') {
        worryButtons.classList.add('hidden');
        otherWorryForm.classList.remove('hidden');
        otherWorryText.focus();
        return;
      }

      selectedWorry = btn.dataset.worry;
      selectedWorryText = null;
      selectedWorrySpan.textContent = WORRY_LABELS[selectedWorry];
      showStep(stepPhoto);
    });
  });

  otherWorrySubmit.addEventListener('click', () => {
    const text = otherWorryText.value.trim();
    if (!text) {
      otherWorryText.focus();
      return;
    }

    selectedWorry = 'other';
    selectedWorryText = text;
    selectedWorrySpan.textContent = text;
    showStep(stepPhoto);
  });

  otherWorryBack.addEventListener('click', () => {
    otherWorryForm.classList.add('hidden');
    worryButtons.classList.remove('hidden');
    otherWorryText.value = '';
  });

  function bindPhotoInput(inputEl, onResult) {
    inputEl.addEventListener('change', async () => {
      const file = inputEl.files[0];
      if (!file) return;

      onResult(await resizeImageFile(file));
    });
  }

  function setPhoto1(dataUrl) {
    resizedDataUrl1 = dataUrl;
    preview1.src = dataUrl;
    preview1.classList.remove('hidden');
    submitBtn.disabled = false;
  }

  function setPhoto2(dataUrl) {
    resizedDataUrl2 = dataUrl;
    preview2.src = dataUrl;
    preview2.classList.remove('hidden');
  }

  bindPhotoInput(photoInput1Camera, setPhoto1);
  bindPhotoInput(photoInput1Gallery, setPhoto1);
  bindPhotoInput(photoInput2Camera, setPhoto2);
  bindPhotoInput(photoInput2Gallery, setPhoto2);

  // スマホの<input capture>はネイティブカメラを起動できるが、
  // PCのブラウザはこの属性を無視してファイル選択ダイアログを開くだけになる。
  // そのため、まずgetUserMediaでWebカメラの映像を取得して自前の撮影UIを開き、
  // 取得できない環境（対応ブラウザでない・権限拒否など）では
  // 従来通り<input capture>のクリックにフォールバックする。
  function stopCameraStream() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
  }

  function closeCameraModal() {
    stopCameraStream();
    cameraVideo.srcObject = null;
    cameraModal.classList.add('hidden');
    activeCameraSlot = null;
  }

  async function openCamera(slot) {
    const fallbackInput = slot === 1 ? photoInput1Camera : photoInput2Camera;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      fallbackInput.click();
      return;
    }

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      activeCameraSlot = slot;
      cameraVideo.srcObject = cameraStream;
      cameraModal.classList.remove('hidden');
    } catch (err) {
      console.warn('getUserMedia failed, falling back to native file picker:', err);
      fallbackInput.click();
    }
  }

  photoCameraBtn1.addEventListener('click', () => openCamera(1));
  photoCameraBtn2.addEventListener('click', () => openCamera(2));

  cameraShutter.addEventListener('click', () => {
    const dataUrl = drawToCanvas(cameraVideo, cameraVideo.videoWidth, cameraVideo.videoHeight);
    if (activeCameraSlot === 1) setPhoto1(dataUrl);
    else if (activeCameraSlot === 2) setPhoto2(dataUrl);
    closeCameraModal();
  });

  cameraCancel.addEventListener('click', closeCameraModal);

  function resetChat() {
    chatLog.innerHTML = '';
    chatInput.value = '';
    chatInputRow.classList.remove('hidden');
    chatLimitActions.classList.add('hidden');
  }

  function appendChatMessage(role, text) {
    const bubble = document.createElement('p');
    bubble.className = role === 'user' ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-assistant';
    bubble.textContent = text;
    chatLog.appendChild(bubble);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  submitBtn.addEventListener('click', async () => {
    if (!resizedDataUrl1 || !selectedWorry) return;

    showStep(stepLoading);

    const images = [resizedDataUrl1];
    if (resizedDataUrl2) images.push(resizedDataUrl2);

    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          worry: selectedWorry,
          worryText: selectedWorryText,
          images,
        }),
      });

      if (res.status === 429) {
        const data = await res.json();
        errorMessage.textContent = data.error || '本日の鑑定回数の上限に達しました。また明日お試しください。';
        showStep(stepError);
        return;
      }

      if (!res.ok) {
        throw new Error(`submit failed: ${res.status}`);
      }

      const data = await res.json();

      if (data.unreadable) {
        showStep(stepUnreadable);
        return;
      }

      readingTextEl.textContent = data.reading;
      chatInput.placeholder = data.followUpExample ? `例：${data.followUpExample}` : '気になることを聞いてみてください';
      resetChat();
      showStep(stepResult);
    } catch (err) {
      console.error(err);
      errorMessage.textContent = 'エラーが発生しました。もう一度お試しください。';
      showStep(stepError);
    }
  });

  async function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    appendChatMessage('user', text);
    chatInput.value = '';
    chatInput.disabled = true;
    chatSendBtn.disabled = true;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text }),
      });

      if (res.status === 429) {
        const data = await res.json();
        appendChatMessage('assistant', data.error || '本日の利用上限に達しました。また明日お試しください。');
        return;
      }

      if (!res.ok) {
        throw new Error(`chat failed: ${res.status}`);
      }

      const data = await res.json();

      if (data.reply) {
        appendChatMessage('assistant', data.reply);
      }

      if (data.limitReached) {
        chatInputRow.classList.add('hidden');
        chatLimitActions.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
      appendChatMessage('assistant', '少し混み合っているようです。少し時間をおいてから、もう一度送ってみてください。');
    } finally {
      chatInput.disabled = false;
      chatSendBtn.disabled = false;
      chatInput.focus();
    }
  }

  chatSendBtn.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  async function clearSession() {
    try {
      await fetch('/api/delete-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch (err) {
      console.error('delete-session error:', err);
    }
    resetChat();
    appendChatMessage('assistant', 'これまでの鑑定内容とやりとりを削除しました。またいつでも新しく手相を占ってくださいね。');
    chatInputRow.classList.add('hidden');
  }

  chatDeleteBtn.addEventListener('click', clearSession);
  chatClearBtn.addEventListener('click', clearSession);

  chatKeepBtn.addEventListener('click', () => {
    chatLimitActions.classList.add('hidden');
    appendChatMessage('assistant', '承知しました。このまま残しておきますね。');
  });

  function resetPhotos() {
    resizedDataUrl1 = null;
    resizedDataUrl2 = null;
    photoInput1Camera.value = '';
    photoInput1Gallery.value = '';
    photoInput2Camera.value = '';
    photoInput2Gallery.value = '';
    preview1.classList.add('hidden');
    preview2.classList.add('hidden');
    submitBtn.disabled = true;
  }

  function goToWorryStep() {
    closeCameraModal();
    selectedWorry = null;
    selectedWorryText = null;
    resetPhotos();
    otherWorryForm.classList.add('hidden');
    otherWorryText.value = '';
    worryButtons.classList.remove('hidden');
    showStep(stepWorry);
  }

  retryBtn.addEventListener('click', goToWorryStep);
  newReadingBtn.addEventListener('click', goToWorryStep);

  // 手相が読み取れなかった場合は、悩みの選択はそのままに写真だけ撮り直してもらう
  rereadBtn.addEventListener('click', () => {
    resetPhotos();
    showStep(stepPhoto);
  });
})();
