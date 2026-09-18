import React, { useState, useRef, useEffect } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

const QUICK_PROMPTS = [
  "سفرهای فعال بین تهران و اصفهان چه مواردی هستند؟",
  "نحوه رزرو صندلی در سفریار چگونه است؟",
  "شرایط تایید راننده توسط بازرس چیست؟",
];

export const FloatingChatWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "سلام! من دستیار هوشمند سفریار هستم. چطور می‌توانم در مورد استعلام سفرها یا سوالات سامانه کمکتان کنم؟",
      timestamp: new Date().toLocaleTimeString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      inputRef.current?.focus();
    }
  }, [isOpen, messages]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isLoading) return;

    const userMessage: Message = {
      id: "user-" + Date.now(),
      role: "user",
      text: query,
      timestamp: new Date().toLocaleTimeString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({
          role: m.role,
          text: m.text,
        }));

      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query,
          history,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.detail || "خطا در ارتباط با سرور هوش مصنوعی");
      }

      const botMessage: Message = {
        id: "bot-" + Date.now(),
        role: "assistant",
        text: data.reply || "پاسخی دریافت نشد.",
        timestamp: new Date().toLocaleTimeString("fa-IR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (err: any) {
      const errorMessage: Message = {
        id: "err-" + Date.now(),
        role: "assistant",
        text: `⚠️ خطا: ${err?.message || "مشکلی در پاسخگویی پیش آمد. لطفاً مجدداً تلاش کنید."}`,
        timestamp: new Date().toLocaleTimeString("fa-IR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div id="floating-chat-container" dir="rtl" className="fixed bottom-6 right-6 z-50 font-sans">
      {/* دکمه شناور باز/بسته کردن چت */}
      {!isOpen && (
        <button
          id="btn-open-chat"
          onClick={() => setIsOpen(true)}
          className="group flex items-center gap-3 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 pl-5 pr-3 py-2.5 text-white shadow-xl transition-all duration-300 hover:scale-105 hover:shadow-indigo-500/30 focus:outline-none focus:ring-4 focus:ring-indigo-300"
          aria-label="گفتگو با دستیار هوشمند سفریار"
        >
          <div className="relative flex items-center justify-center">
            <img
              src="/frontend/assets/safaryar-logo.svg"
              alt="لوگوی سفریار"
              className="h-10 w-auto object-contain transition-transform group-hover:scale-105"
            />
          </div>
          <span className="text-sm font-bold tracking-wide">دستیار هوشمند سفر</span>
        </button>
      )}

      {/* پنجره گفتگوی چت */}
      {isOpen && (
        <div
          id="chat-window-box"
          className="flex h-[540px] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-300"
        >
          {/* هدر چت */}
          <div className="flex items-center justify-between border-b border-indigo-700 bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-3 text-white">
            <div className="flex items-center gap-3">
              <img
                src="/frontend/assets/safaryar-logo.svg"
                alt="لوگوی سفریار"
                className="h-11 w-auto object-contain"
              />
              <div>
                <h3 className="text-sm font-extrabold leading-tight">پشتیبان هوشمند سفریار</h3>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
                  <span className="text-[11px] font-medium text-emerald-100">
                    آنلاین • مجهز به Gemini
                  </span>
                </div>
              </div>
            </div>

            <button
              id="btn-close-chat"
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-1.5 text-white/80 hover:bg-white/20 hover:text-white transition focus:outline-none"
              aria-label="بستن پنجره گفتگو"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* بدنه و فهرست پیام‌ها */}
          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.role === "user" ? "items-start" : "items-end"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-sm ${
                    m.role === "user"
                      ? "rounded-br-none bg-indigo-600 text-white font-medium"
                      : "rounded-bl-none border border-slate-200 bg-white text-slate-800"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>
                <span className="mt-1 px-1 text-[10px] text-slate-400">{m.timestamp}</span>
              </div>
            ))}

            {/* نشانگر در حال تایپ */}
            {isLoading && (
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-none border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-600"></div>
                  <div
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-600"
                    style={{ animationDelay: "0.2s" }}
                  ></div>
                  <div
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-600"
                    style={{ animationDelay: "0.4s" }}
                  ></div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* پرسش‌های پیشنهادی */}
          {messages.length <= 2 && (
            <div className="border-t border-slate-100 bg-white px-3 py-2">
              <div className="text-[11px] font-bold text-slate-500 mb-1.5">پیشنهادات گفتگو:</div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(prompt)}
                    className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* اینپوت ورودی پیام */}
          <div className="border-t border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                id="input-chat-message"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                placeholder="سوال خود را بپرسید..."
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition disabled:opacity-50"
              />
              <button
                id="btn-send-chat-message"
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow transition hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600 focus:outline-none"
                aria-label="ارسال پیام"
              >
                <svg
                  className="h-4 w-4 rotate-180 transform"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14 5l7 7m0 0l-7 7m7-7H3"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FloatingChatWidget;
