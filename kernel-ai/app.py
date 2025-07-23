from flask import Flask, jsonify
import psutil
import openai
import os

openai.api_key = os.getenv("OPENAI_API_KEY")

app = Flask(__name__)

@app.route("/api/process-kernel-map")
def process_kernel_map():
    processes = []
    for proc in psutil.process_iter(['name']):
        try:
            if proc.info['name']:
                processes.append(proc.info['name'])
        except:
            continue

    prompt = (
        "Свяжи каждый процесс с подсистемами ядра Linux, которые он использует. "
        "Формат: {\"имя процесса\": [\"путь/к/подсистеме\"]}. "
        "Пример: {\"sshd\": [\"net/ipv4\", \"crypto\"]}\n\n"
        "Процессы:\n" + "\n".join(f"- {name}" for name in set(processes))
    )

    try:
        res = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}]
        )
        answer = res['choices'][0]['message']['content']
        return jsonify(eval(answer))  # Преобразуем строку JSON-формата в dict
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
