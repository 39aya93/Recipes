const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let registerIngredients = [];
let updateIngredients = [];

/* ================================
   メッセージ
   ================================ */
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 2500);
}

/* ================================
   API
   ================================ */
async function api(action, data = {}) {
  if (!API_URL || API_URL.includes("ここに")) {
    throw new Error("config.js の API_URL を設定してください");
  }
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...data })
  });
  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.error || "APIエラー");
  }
  return result;
}

/* ================================
   画像
   ================================ */
async function fileToBase64(file) {
  if (!file) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1];
      resolve({ name: file.name, type: file.type, data: base64 });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function previewFile(input, image) {
  const file = input.files[0];
  if (!file) {
    image.classList.add("hidden");
    return;
  }
  image.src = URL.createObjectURL(file);
  image.classList.remove("hidden");
}

$("#registerImage").onchange = () => previewFile($("#registerImage"), $("#registerPreview"));
$("#updateImage").onchange = () => previewFile($("#updateImage"), $("#updatePreview"));

/* ================================
   ペジ切替
   ================================ */
function showPage(page) {
  $$(".page").forEach(x => x.classList.toggle("active", x.id === "page-" + page));
  $$(".nav").forEach(x => x.classList.toggle("active", x.dataset.page === page));
  if (page === "update") loadUpdateList();
}

$$(".nav").forEach(button => {
  button.onclick = () => showPage(button.dataset.page);
});

/* ================================
   食材チップ管理
   ================================ */
function renderIngredientChips(mode) {
  const box = $(`#${mode}IngredientsBox`);
  const list = mode === "register" ? registerIngredients : updateIngredients;
  box.innerHTML = list.map((ing, i) => `
    <span class="ingredient-chip">
      ${esc(ing.displayName || ing.kanji || ing.kana || ing.katakana || "(未命名)")}
      <button type="button" onclick="removeIngredient('${mode}', ${i})">&times;</button>
    </span>
  `).join("");
}

function addIngredient(mode) {
  const display = $(`#${mode}IngredientInput`).value.trim();
  const kanji = $(`#${mode}IngredientKanji`).value.trim();
  const kana = $(`#${mode}IngredientKana`).value.trim();
  const katakana = $(`#${mode}IngredientKata`).value.trim();

  if (!display && !kanji && !kana && !katakana) {
    toast("食材名を入力してください");
    return;
  }

  const item = { displayName: display, kanji, kana, katakana };
  if (mode === "register") {
    registerIngredients.push(item);
  } else {
    updateIngredients.push(item);
  }

  $(`#${mode}IngredientInput`).value = "";
  $(`#${mode}IngredientKanji`).value = "";
  $(`#${mode}IngredientKana`).value = "";
  $(`#${mode}IngredientKata`).value = "";

  renderIngredientChips(mode);
}

function removeIngredient(mode, index) {
  if (mode === "register") {
    registerIngredients.splice(index, 1);
  } else {
    updateIngredients.splice(index, 1);
  }
  renderIngredientChips(mode);
}

/* ================================
   食材候補
   ================================ */
let candidateTimer;
$("#searchIngredient").addEventListener("input", () => {
  clearTimeout(candidateTimer);
  candidateTimer = setTimeout(loadCandidates, 250);
});

async function loadCandidates() {
  const q = $("#searchIngredient").value.trim();
  const box = $("#ingredientCandidates");
  box.innerHTML = "";
  if (!q) return;

  try {
    const result = await api("ingredientCandidates", { q });
    result.items.forEach(x => {
      const btn = document.createElement("button");
      btn.className = "candidate";
      btn.textContent = x.display;
      btn.onclick = () => {
        $("#searchIngredient").value = x.display;
        search();
      };
      box.appendChild(btn);
    });

    const add = document.createElement("button");
    add.className = "candidate add";
    add.textContent = `「${q}」を新しい料理に追加`;
    add.onclick = () => {
      showPage("register");
      $("#registerIngredientInput").value = q;
    };
    box.appendChild(add);
  } catch (e) {
    toast(e.message);
  }
}

/* ================================
   検索
   ================================ */
$("#searchBtn").onclick = search;

async function search() {
  try {
    const result = await api("search", {
      ingredient: $("#searchIngredient").value,
      recipe: $("#searchRecipe").value
    });
    renderResults(result.items);
  } catch (e) {
    toast(e.message);
  }
}

function renderResults(items) {
  const box = $("#searchResults");
  box.innerHTML = "";

  if (!items.length) {
    box.innerHTML = "<p>該当する料理はありません。</p>";
    return;
  }

  items.forEach(x => {
    const ingredientBadges = (x.ingredients || []).map(ing =>
      `<span class="badge">${esc(ing.displayName || ing.kanji || ing.kana || "")}</span>`
    ).join("");

    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <h3>${esc(x.recipeName)}</h3>
      <div class="meta">
        ${ingredientBadges}
        <span class="badge">温度：${esc(x.temperature)}</span>
        <span class="badge">時間：${esc(x.time)}</span>
      </div>
      ${x.imageUrl ? `<img class="recipe-image" src="${escAttr(x.imageUrl)}" loading="lazy" alt="">` : ""}
      <h4>調理手順</h4>
      <div class="steps">${esc(x.steps)}</div>
      <button type="button" onclick="editRecipe('${escAttr(x.id)}')">この料理を更新</button>
    `;
    box.appendChild(card);
  });
}

/* ================================
   登録
   ================================ */
$("#registerForm").onsubmit = async e => {
  e.preventDefault();
  try {
    const form = e.target;
    if (registerIngredients.length === 0) {
      toast("食材を1つ以上追加してください");
      return;
    }

    const image = await fileToBase64($("#registerImage").files[0]);

    await api("register", {
      record: {
        recipeName: form.recipeName.value,
        temperature: form.temperature.value,
        time: form.time.value,
        steps: form.steps.value,
        image: image,
        ingredients: registerIngredients
      }
    });

    toast("登録しました");
    form.reset();
    registerIngredients = [];
    renderIngredientChips("register");
    $("#registerPreview").classList.add("hidden");
  } catch (err) {
    toast(err.message);
  }
};

/* ================================
   更新一覧
   ================================ */
async function loadUpdateList() {
  const select = $("#updateSelect");
  select.innerHTML = "<option value=''>選択してください</option>";
  try {
    const result = await api("list");
    result.items.forEach(x => {
      const option = document.createElement("option");
      option.value = x.id;
      option.textContent = `${x.ingredientDisplay} / ${x.recipeName}`;
      select.appendChild(option);
    });
  } catch (e) {
    toast(e.message);
  }
}

/* ================================
   更新対象取得
   ================================ */
$("#updateSelect").onchange = async () => {
  const id = $("#updateSelect").value;
  if (!id) {
    $("#updateForm").classList.add("hidden");
    return;
  }
  try {
    const result = await api("get", { id });
    fillUpdate(result.item);
    $("#updateForm").classList.remove("hidden");
  } catch (e) {
    toast(e.message);
  }
};

function fillUpdate(x) {
  const form = $("#updateForm");
  form.id.value = x.id;
  form.imageFileId.value = x.imageFileId || "";
  form.recipeName.value = x.recipeName || "";
  form.temperature.value = x.temperature || "";
  form.time.value = x.time || "";
  form.steps.value = x.steps || "";

  updateIngredients = (x.ingredients || []).map(ing => ({
    displayName: ing.displayName || "",
    kanji: ing.kanji || "",
    kana: ing.kana || "",
    katakana: ing.katakana || ""
  }));
  renderIngredientChips("update");

  if (x.imageUrl) {
    $("#updatePreview").src = x.imageUrl;
    $("#updatePreview").classList.remove("hidden");
  } else {
    $("#updatePreview").classList.add("hidden");
  }
}

/* ================================
   更新
   ================================ */
$("#updateForm").onsubmit = async e => {
  e.preventDefault();
  try {
    const form = e.target;
    if (updateIngredients.length === 0) {
      toast("食材を1つ以上追加してください");
      return;
    }

    const image = await fileToBase64($("#updateImage").files[0]);

    await api("update", {
      record: {
        id: form.id.value,
        recipeName: form.recipeName.value,
        temperature: form.temperature.value,
        time: form.time.value,
        steps: form.steps.value,
        image: image,
        imageFileId: form.imageFileId.value,
        ingredients: updateIngredients
      }
    });

    toast("更新しました");
    loadUpdateList();
  } catch (err) {
    toast(err.message);
  }
};

/* ================================
   検索結果から更新へ遷移
   ================================ */
async function editRecipe(id) {
  showPage("update");
  await loadUpdateList();
  $("#updateSelect").value = id;
  $("#updateSelect").dispatchEvent(new Event("change"));
}

/* ================================
   HTMLエスケープ
   ================================ */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function escAttr(s) {
  return esc(s);
}
