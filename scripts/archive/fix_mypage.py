import re

path = "client/src/pages/MyPage.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add import if not exists
if 'import { useTranslation }' not in content:
    content = content.replace('import { toast } from "sonner";', 'import { toast } from "sonner";\nimport { useTranslation } from "react-i18next";')

# 2. Add t to MyPage
content = re.sub(r'(export default function MyPage\(\) \{)', r'\1\n  const { t } = useTranslation();', content)

# 3. Add t to OrderListItem
content = re.sub(r'(function OrderListItem\([^)]+\) \{)', r'\1\n  const { t } = useTranslation();', content)

# 4. Add t to SettingsPanel
content = re.sub(r'(function SettingsPanel\([^)]+\) \{)', r'\1\n  const { t } = useTranslation();', content)

# 5. Add t to NotificationBell
content = re.sub(r'(function NotificationBell\([^)]+\) \{)', r'\1\n  const { t } = useTranslation();', content)

# 6. Replace err?.message with t("common.paymentFailed")
content = content.replace('toast.error(err?.message ?? "Failed to create payment session. Please try again.");', 'toast.error(t("common.paymentFailed"));')

# 7. Replace e.message with t("common.saveFailed")
content = content.replace('setError(e.message);', 'setError(t("common.saveFailed"));')

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("MyPage fixed!")
