import os
import re

target_dir = "functions/src"

for root, _, files in os.walk(target_dir):
    for file in files:
        if file.endswith(".ts") and not file.endswith(".test.ts"):
            path = os.path.join(root, file)
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()

            if "console." in content:
                # Add import if missing
                if "import * as logger" not in content and "from \"firebase-functions/logger\"" not in content:
                    content = 'import * as logger from "firebase-functions/logger";\n' + content
                
                content = re.sub(r'\bconsole\.log\b', 'logger.info', content)
                content = re.sub(r'\bconsole\.info\b', 'logger.info', content)
                content = re.sub(r'\bconsole\.warn\b', 'logger.warn', content)
                content = re.sub(r'\bconsole\.error\b', 'logger.error', content)
                
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content)
                print(f"Updated {path}")
