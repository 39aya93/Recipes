const CONFIG = {
  RECIPE_SHEET: 'Recipes',
  INGREDIENT_SHEET: 'Ingredients',
  RELATION_SHEET: 'RecipeIngredients',
  IMAGE_FOLDER: 'CookingRecipeImages'
};

/* -------------------------------
   Web API
   ------------------------------- */
function doGet(e) {
  return jsonResponse({status: 'ok', version: getAppVersion()});
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ok: false, error: 'Invalid JSON: ' + err.message});
  }

  const action = data.action;

  try {
    let result;
    switch (action) {
      case 'search':
        result = {ok: true, items: formatRecipes(searchRecipes(data.ingredient, data.recipe))};
        break;
      case 'ingredientCandidates':
        result = {ok: true, items: formatIngredients(searchIngredients(data.q))};
        break;
      case 'list':
        result = {ok: true, items: formatRecipeList(getDatabase())};
        break;
      case 'get':
        result = {ok: true, item: formatRecipe(getRecipe(data.id))};
        break;
      case 'register':
      case 'update':
        const saved = saveRecipe(transformRecord(data.record));
        result = {ok: true, recipeId: saved.recipeId};
        break;
      case 'delete':
        result = deleteRecipe(data.id);
        result = {ok: true};
        break;
      default:
        result = {ok: false, error: 'Unknown action: ' + action};
    }
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ok: false, error: err.message});
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function transformRecord(record) {
  return {
    recipeId: record.id || '',
    recipeName: record.recipeName || '',
    temperature: record.temperature || '',
    cookingTime: record.time || '',
    steps: record.steps || '',
    imageData: record.image || null,
    imageFileId: record.imageFileId || '',
    ingredients: (record.ingredients || []).map(function(ing) {
      return {
        ingredientId: ing.id || '',
        displayName: ing.displayName || '',
        kanji: ing.kanji || '',
        kana: ing.kana || '',
        katakana: ing.katakana || ''
      };
    })
  };
}

function formatRecipes(recipes) {
  return recipes.map(formatRecipe);
}

function formatRecipe(recipe) {
  if (!recipe) return null;
  const firstIngredient = recipe.ingredients[0] || {};
  return {
    id: recipe.recipeId,
    recipeName: recipe.recipeName,
    ingredientDisplay: firstIngredient.displayName || firstIngredient.kanji || firstIngredient.kana || '',
    ingredients: recipe.ingredients,
    temperature: recipe.temperature,
    time: recipe.cookingTime,
    steps: recipe.steps,
    imageUrl: getImageUrl(recipe.imageFileId),
    imageFileId: recipe.imageFileId || ''
  };
}

function formatRecipeList(recipes) {
  return recipes.map(function(r) {
    const first = (r.ingredients || [])[0] || {};
    return {
      id: r.recipeId,
      ingredientDisplay: first.displayName || '',
      recipeName: r.recipeName
    };
  });
}

function formatIngredients(ingredients) {
  return ingredients.map(function(ing) {
    return {
      id: ing.ingredientId,
      display: ing.displayName || ing.kanji || ing.kana || ing.katakana || ''
    };
  });
}

/* -------------------------------
   セットアップ
   ------------------------------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  createSheetIfNotExists_(ss, CONFIG.RECIPE_SHEET, ['recipeId','recipeName','temperature','cookingTime','steps','imageFileId','updatedAt']);
  createSheetIfNotExists_(ss, CONFIG.INGREDIENT_SHEET, ['ingredientId','displayName','kanji','kana','katakana','updatedAt']);
  createSheetIfNotExists_(ss, CONFIG.RELATION_SHEET, ['recipeId','ingredientId']);
  getImageFolder_();
  return {success: true, message: '初期セットアップが完了しました。'};
}

function createSheetIfNotExists_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function getImageFolder_() {
  const folders = DriveApp.getFoldersByName(CONFIG.IMAGE_FOLDER);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(CONFIG.IMAGE_FOLDER);
}

function createId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16);
}

function normalizeText_(value) {
  if (value === null || value === undefined) return '';
  let text = String(value).trim();
  text = text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
  text = text.replace(/[ァ-ヶ]/g, function(c) {
    return String.fromCharCode(c.charCodeAt(0) - 0x60);
  });
  return text.toLowerCase();
}

function toKatakana_(value) {
  if (!value) return '';
  return String(value).replace(/[ぁ-ゖ]/g, function(c) {
    return String.fromCharCode(c.charCodeAt(0) + 0x60);
  });
}

function getSheetObjects_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1).map(function(row) {
    const obj = {};
    headers.forEach(function(header, index) {
      obj[header] = row[index];
    });
    return obj;
  });
}

/* -------------------------------
   DB読み込み
   ------------------------------- */
function getDatabase() {
  const recipes = getSheetObjects_(CONFIG.RECIPE_SHEET);
  const ingredients = getSheetObjects_(CONFIG.INGREDIENT_SHEET);
  const relations = getSheetObjects_(CONFIG.RELATION_SHEET);

  const ingredientMap = {};
  ingredients.forEach(function(item) {
    ingredientMap[item.ingredientId] = item;
  });

  const recipeIngredients = {};
  relations.forEach(function(rel) {
    if (!recipeIngredients[rel.recipeId]) recipeIngredients[rel.recipeId] = [];
    const ingredient = ingredientMap[rel.ingredientId];
    if (ingredient) {
      recipeIngredients[rel.recipeId].push({
        ingredientId: ingredient.ingredientId,
        displayName: ingredient.displayName,
        kanji: ingredient.kanji,
        kana: ingredient.kana,
        katakana: ingredient.katakana
      });
    }
  });

  return recipes.map(function(recipe) {
    return {
      recipeId: recipe.recipeId,
      recipeName: recipe.recipeName,
      temperature: recipe.temperature,
      cookingTime: recipe.cookingTime,
      steps: recipe.steps,
      imageFileId: recipe.imageFileId || '',
      updatedAt: recipe.updatedAt,
      ingredients: recipeIngredients[recipe.recipeId] || []
    };
  });
}

/* -------------------------------
   検索
   ------------------------------- */
function searchIngredients(keyword) {
  const key = normalizeText_(keyword);
  const ingredients = getSheetObjects_(CONFIG.INGREDIENT_SHEET);
  if (!key) return ingredients.slice(0, 30);
  return ingredients.filter(function(item) {
    return [item.displayName, item.kanji, item.kana, item.katakana].some(function(value) {
      return normalizeText_(value).indexOf(key) !== -1;
    });
  }).slice(0, 30);
}

function searchRecipes(ingredientKeyword, recipeKeyword) {
  const ingredientKey = normalizeText_(ingredientKeyword);
  const recipeKey = normalizeText_(recipeKeyword);
  const recipes = getDatabase();
  return recipes.filter(function(recipe) {
    const recipeMatch = !recipeKey || normalizeText_(recipe.recipeName).indexOf(recipeKey) !== -1;
    const ingredientMatch = !ingredientKey || recipe.ingredients.some(function(ingredient) {
      return [ingredient.displayName, ingredient.kanji, ingredient.kana, ingredient.katakana].some(function(value) {
        return normalizeText_(value).indexOf(ingredientKey) !== -1;
      });
    });
    return recipeMatch && ingredientMatch;
  }).sort(function(a, b) {
    return String(a.recipeName).localeCompare(String(b.recipeName), 'ja');
  });
}

function getRecipe(recipeId) {
  const recipes = getDatabase();
  return recipes.find(function(recipe) {
    return recipe.recipeId === recipeId;
  }) || null;
}

/* -------------------------------
   食材マスター保存
   ------------------------------- */
function saveIngredientMaster(data) {
  if (!data) throw new Error('食材データがありません。');
  const displayName = String(data.displayName || '').trim();
  const kanji = String(data.kanji || '').trim();
  const kana = String(data.kana || '').trim();
  const katakana = String(data.katakana || '').trim();
  if (!displayName && !kanji && !kana && !katakana) {
    throw new Error('食材名を入力してください。');
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.INGREDIENT_SHEET);
  let ingredientId = data.ingredientId;

  if (!ingredientId) {
    ingredientId = createId_('I');
    sheet.appendRow([ingredientId, displayName, kanji, kana, katakana, new Date()]);
    return ingredientId;
  }

  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === ingredientId) {
      sheet.getRange(i + 1, 1, 1, 6).setValues([[ingredientId, displayName, kanji, kana, katakana, new Date()]]);
      return ingredientId;
    }
  }
  return ingredientId;
}

/* -------------------------------
   画像保存
   ------------------------------- */
function saveImage_(imageData) {
  if (!imageData || !imageData.data) return '';
  const folder = getImageFolder_();
  let base64 = imageData.data;
  if (base64.indexOf(',') >= 0) {
    base64 = base64.split(',')[1];
  }
  const bytes = Utilities.base64Decode(base64);
  const mimeType = imageData.type || imageData.mimeType || 'image/jpeg';
  const extension = mimeType.indexOf('png') >= 0 ? 'png' : 'jpg';
  const blob = Utilities.newBlob(bytes, mimeType, 'recipe_' + Utilities.getUuid() + '.' + extension);
  const file = folder.createFile(blob);
  return file.getId();
}

/* -------------------------------
   レシピ保存（新規・更新共通）
   ------------------------------- */
function saveRecipe(data) {
  if (!data) throw new Error('料理データがありません。');
  const recipeName = String(data.recipeName || '').trim();
  if (!recipeName) throw new Error('料理名を入力してください。');
  const ingredients = Array.isArray(data.ingredients) ? data.ingredients : [];
  if (ingredients.length === 0) throw new Error('食材を1つ以上登録してください。');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const recipeSheet = ss.getSheetByName(CONFIG.RECIPE_SHEET);
  const relationSheet = ss.getSheetByName(CONFIG.RELATION_SHEET);

  let recipeId = data.recipeId || createId_('R');
  let imageFileId = data.imageFileId || '';

  const recipes = getSheetObjects_(CONFIG.RECIPE_SHEET);
  let oldImageFileId = '';
  let recipeRow = -1;

  recipes.forEach(function(recipe, index) {
    if (recipe.recipeId === recipeId) {
      recipeRow = index + 2;
      oldImageFileId = recipe.imageFileId || '';
    }
  });

  // 画像差し替え時は旧画像を削除
  if (data.imageData && data.imageData.data) {
    if (oldImageFileId) {
      try {
        DriveApp.getFileById(oldImageFileId).setTrashed(true);
      } catch (e) {
        console.log('旧画像削除失敗: ' + e);
      }
    }
    imageFileId = saveImage_(data.imageData);
  }

  const recipeValues = [recipeId, recipeName, data.temperature || '', data.cookingTime || '', data.steps || '', imageFileId, new Date()];

  if (recipeRow === -1) {
    recipeSheet.appendRow(recipeValues);
  } else {
    recipeSheet.getRange(recipeRow, 1, 1, recipeValues.length).setValues([recipeValues]);
  }

  // 既存の関連付けを削除
  const relationValues = relationSheet.getDataRange().getValues();
  for (let i = relationValues.length - 1; i >= 1; i--) {
    if (relationValues[i][0] === recipeId) {
      relationSheet.deleteRow(i + 1);
    }
  }

  // 食材マスターを1回だけ読み込んで再利用
  const allIngredients = getSheetObjects_(CONFIG.INGREDIENT_SHEET);

  ingredients.forEach(function(item) {
    const displayName = String(item.displayName || '').trim();
    const kanji = String(item.kanji || '').trim();
    const kana = String(item.kana || '').trim();
    const katakana = String(item.katakana || '').trim();
    if (!displayName && !kanji && !kana && !katakana) return;

    let ingredientId = item.ingredientId || '';
    if (ingredientId) {
      saveIngredientMaster({
        ingredientId: ingredientId,
        displayName: displayName,
        kanji: kanji,
        kana: kana,
        katakana: katakana
      });
    } else {
      const existing = findIngredient_(displayName, kanji, kana, katakana, allIngredients);
      if (existing) {
        ingredientId = existing.ingredientId;
      } else {
        ingredientId = saveIngredientMaster({
          displayName: displayName,
          kanji: kanji,
          kana: kana,
          katakana: katakana
        });
        allIngredients.push({
          ingredientId: ingredientId,
          displayName: displayName,
          kanji: kanji,
          kana: kana,
          katakana: katakana
        });
      }
    }
    relationSheet.appendRow([recipeId, ingredientId]);
  });

  return {success: true, recipeId: recipeId};
}

/* -------------------------------
   同一食材検索
   ------------------------------- */
function findIngredient_(displayName, kanji, kana, katakana, ingredients) {
  const targetIngredients = ingredients || getSheetObjects_(CONFIG.INGREDIENT_SHEET);
  const keys = [displayName, kanji, kana, katakana].map(normalizeText_).filter(Boolean);
  if (keys.length === 0) return null;
  return targetIngredients.find(function(item) {
    const values = [item.displayName, item.kanji, item.kana, item.katakana].map(normalizeText_).filter(Boolean);
    return keys.some(function(key) {
      return values.indexOf(key) !== -1;
    });
  }) || null;
}

/* -------------------------------
   レシピ削除
   ------------------------------- */
function deleteRecipe(recipeId) {
  if (!recipeId) throw new Error('recipeIdがありません。');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const recipeSheet = ss.getSheetByName(CONFIG.RECIPE_SHEET);
  const relationSheet = ss.getSheetByName(CONFIG.RELATION_SHEET);

  const recipes = recipeSheet.getDataRange().getValues();
  for (let i = recipes.length - 1; i >= 1; i--) {
    if (recipes[i][0] === recipeId) {
      const fileId = recipes[i][5];
      if (fileId) {
        try {
          DriveApp.getFileById(fileId).setTrashed(true);
        } catch (e) {
          console.log('画像削除失敗: ' + e);
        }
      }
      recipeSheet.deleteRow(i + 1);
      break;
    }
  }

  const relations = relationSheet.getDataRange().getValues();
  for (let i = relations.length - 1; i >= 1; i--) {
    if (relations[i][0] === recipeId) {
      relationSheet.deleteRow(i + 1);
    }
  }
  return {success: true};
}

/* -------------------------------
   画像URL
   ------------------------------- */
function getImageUrl(fileId) {
  if (!fileId) return '';
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w1200';
}

function getAppVersion() {
  return new Date().getTime();
}

/* -------------------------------
   旧DB移行
   ------------------------------- */
function migrateLegacyData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const recipeSheet = ss.getSheetByName(CONFIG.RECIPE_SHEET);
  if (!recipeSheet) {
    throw new Error('Recipesシートがありません。先にsetup()を実行してください。');
  }
  const relationSheet = ss.getSheetByName(CONFIG.RELATION_SHEET);
  const values = recipeSheet.getDataRange().getValues();
  if (values.length <= 1) {
    return {success: true, message: '移行対象データはありません。'};
  }

  const headers = values[0];
  const index = {};
  headers.forEach(function(header, i) {
    index[header] = i;
  });

  if (index.ingredientDisplay === undefined && index.ingredientKanji === undefined && index.ingredientKana === undefined && index.ingredientKatakana === undefined) {
    return {success: true, message: '旧形式の食材列が見つかりません。移行は不要です。'};
  }

  let count = 0;
  const allRelationValues = relationSheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const recipeId = row[index.recipeId];
    if (!recipeId) continue;

    const ingredient = {
      displayName: index.ingredientDisplay !== undefined ? row[index.ingredientDisplay] : '',
      kanji: index.ingredientKanji !== undefined ? row[index.ingredientKanji] : '',
      kana: index.ingredientKana !== undefined ? row[index.ingredientKana] : '',
      katakana: index.ingredientKatakana !== undefined ? row[index.ingredientKatakana] : ''
    };

    if (!ingredient.displayName && !ingredient.kanji && !ingredient.kana && !ingredient.katakana) continue;

    const existing = findIngredient_(ingredient.displayName, ingredient.kanji, ingredient.kana, ingredient.katakana);
    let ingredientId;
    if (existing) {
      ingredientId = existing.ingredientId;
    } else {
      ingredientId = saveIngredientMaster(ingredient);
    }

    const alreadyExists = allRelationValues.some(function(rel) {
      return rel[0] === recipeId && rel[1] === ingredientId;
    });

    if (!alreadyExists) {
      relationSheet.appendRow([recipeId, ingredientId]);
      allRelationValues.push([recipeId, ingredientId]);
      count++;
    }
  }

  return {success: true, message: count + '件の食材関連付けを移行しました。'};
}
