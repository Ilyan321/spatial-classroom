# 🥽 Spatial Classroom

A gamified "Reverse Classroom" web application built to test your comprehension of any topic using the Feynman Technique. Instead of an AI teaching you, **you must teach a stubborn, easily confused 12-year-old AI student named Leo.** 

If your explanations contain too much jargon, Leo jumps on his desk or loses patience. You only win when his understanding hits 100%.

---

## ⚡ Core Features

*   **Reverse-Tutor State Machine:** Implements a real-time conversational loop tracking student comprehension, patience, and visual reactions (`eureka`, `confused`, `bored`).
*   **Dual-Stream Groq Engine:** Single backend routing function running distinct system prompts for the student loop and a secret, conversational **Teacher Co-Pilot chatbot**.
*   **Spatial UI Design:** Implements an ultra-clean, frosted-glass desktop environment featuring automatic layout dimming and persistent state dark/light theme switching.
*   **Dynamic Context Injection:** Extracted text from uploaded study materials (PDFs/Images) is fed directly into the local browser state to ground the AI's questioning parameters.

---

## 🛠️ The \$0 Cost Tech Stack

*   **Frontend UI:** [Google Stitch](https://withgoogle.com) (Tailwind CSS / Mobile-Responsive Grid)
*   **Inference Speed:** [Groq API](https://groq.com) (`llama-3.3-70b-versatile` running at sub-second LPUs latency)
*   **Serverless Wrapper:** [Netlify Edge Functions](https://netlify.com) (Secure, zero-latency Deno runtime)

---

## 📂 Project Structure

```text
spatial-classroom/
├── netlify/
│   └── edge-functions/
│       └── groq-stream.js       # Secure dual-stream Groq serverless wrapper
├── src/
│   ├── app.js                   # State machine, focus dimming, & UI orchestrator
│   └── styles.css               # Smooth animation rules and custom properties
├── index.html                   # Refactored responsive Spatial layout 
└── netlify.toml                 # Root deployment configuration file
```

---

## 🚀 Quick Local Setup

1. **Install Netlify CLI:**
   ```bash
   npm install -g netlify-cli
   ```

2. **Boot the Local Environment:**
   Pass your secret key string inline to authorize local proxy routing:
   ```bash
   GROQ_API_KEY=your_key_here ntl dev
   ```
   Open `http://localhost:8888` in your browser.

---

## 📦 Production Deployment

This project is optimized for instant continuous deployment via **Netlify**. Simply link this GitHub repository directly to your Netlify profile dashboard and add your environment variable:

*   `GROQ_API_KEY` = `your_secret_groq_key_here`

---

## 📄 License
This project is open-source and available under the terms of the MIT License.
