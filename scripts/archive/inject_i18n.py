import os
import re

locales = {
    "en": {
        "loginFailed": "Login failed. Please try again.",
        "paymentFailed": "Payment failed. Please try again.",
        "saveFailed": "Failed to save. Please try again.",
        "fetchFailed": "Failed to fetch data. Please try again."
    },
    "ko": {
        "loginFailed": "로그인에 실패했습니다. 다시 시도해 주세요.",
        "paymentFailed": "결제에 실패했습니다. 다시 시도해 주세요.",
        "saveFailed": "저장에 실패했습니다. 다시 시도해 주세요.",
        "fetchFailed": "데이터를 불러오는 데 실패했습니다. 다시 시도해 주세요."
    },
    "zh-TW": {
        "loginFailed": "登入失敗，請再試一次。",
        "paymentFailed": "付款失敗，請再試一次。",
        "saveFailed": "儲存失敗，請再試一次。",
        "fetchFailed": "載入資料失敗，請再試一次。"
    },
    "zh-CN": {
        "loginFailed": "登录失败，请重试。",
        "paymentFailed": "支付失败，请重试。",
        "saveFailed": "保存失败，请重试。",
        "fetchFailed": "获取数据失败，请重试。"
    },
    "th": {
        "loginFailed": "การเข้าสู่ระบบล้มเหลว กรุณาลองใหม่อีกครั้ง",
        "paymentFailed": "การชำระเงินล้มเหลว กรุณาลองใหม่อีกครั้ง",
        "saveFailed": "การบันทึกล้มเหลว กรุณาลองใหม่อีกครั้ง",
        "fetchFailed": "การดึงข้อมูลล้มเหลว กรุณาลองใหม่อีกครั้ง"
    }
}

target_dir = "client/src/i18n"

for lang, additions in locales.items():
    path = os.path.join(target_dir, f"{lang}.ts")
    if not os.path.exists(path):
        continue
    
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # We want to insert inside `common: { ... }` block
    addition_str = "".join([f'    {k}: "{v}",\n' for k, v in additions.items()])
    
    # find `common: {`
    match = re.search(r'(common:\s*\{)(.*?)(  \},)', content, re.DOTALL)
    if match:
        common_block = match.group(2)
        if "loginFailed:" not in common_block:
            new_common_block = match.group(1) + match.group(2) + addition_str + match.group(3)
            content = content[:match.start()] + new_common_block + content[match.end():]
            
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Updated {path}")
