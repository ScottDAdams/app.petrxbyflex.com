import { useState, useRef, useEffect, useCallback } from "react"
import { API_BASE } from "../../../api"
import "./chatbot.css"

const CHATBOT_AVATAR_URL = "https://flex-chatbot.netlify.app/petrxbyflex_avatar.png"
const getChatApi = () => `${(API_BASE || "https://api.petrxbyflex.com").replace(/\/+$/, "")}/api/chatbot/chat`

/** Render basic markdown in bot messages: **bold**, *italic*, newlines */
function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null
  const out: React.ReactNode[] = []
  let key = 0
  const boldParts = text.split(/\*\*(.+?)\*\*/g)
  boldParts.forEach((seg, i) => {
    const isBold = i % 2 === 1
    const italicParts = seg.split(/\*(.+?)\*/g)
    italicParts.forEach((s, j) => {
      const isItalic = j % 2 === 1
      const lines = s.split("\n")
      lines.forEach((line, k) => {
        if (k > 0) out.push(<br key={key++} />)
        if (isBold && isItalic) out.push(<strong key={key++}><em>{line}</em></strong>)
        else if (isBold) out.push(<strong key={key++}>{line}</strong>)
        else if (isItalic) out.push(<em key={key++}>{line}</em>)
        else out.push(<span key={key++}>{line}</span>)
      })
    })
  })
  return <>{out}</>
}

export type ChatbotPageContext = "homepage" | "insurance"

interface Message {
  id: number
  text: string
  sender: "user" | "bot"
  timestamp: Date
  isError?: boolean
  sources?: { title: string; similarity: number }[]
}

const CONTENT_HOMEPAGE = {
  teaserTitle: "Have questions about PetRx cards?",
  teaserText: "I'm here to help with prescription savings and more! 💊",
  headerTitle: "PetRx Assistant",
  placeholder: "Ask me anything about PetRx cards...",
  initialMessage:
    "Hi! I'm here to help answer any questions you have about PetRx cards. What can I assist you with today?",
}

const CONTENT_INSURANCE = {
  teaserTitle: "Have questions about Pet Insurance?",
  teaserText: "I'm here to help with PetRx cards, coverage, claims, and more! 🐕",
  headerTitle: "PetRx & Insurance Assistant",
  placeholder: "Ask me anything about PetRx cards or pet insurance...",
  initialMessage:
    "Hi! I'm here to help answer any questions you have about PetRx cards and pet insurance. What can I assist you with today?",
}

function MessageCircle({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function Send({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  )
}
function X({ size = 24, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  )
}
function ChevronRight({ size = 16, color = "currentColor", style }: { size?: number; color?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" style={style}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

const baseStyles = {
  container: { position: "fixed" as const, bottom: 32, right: 32, zIndex: 50, fontFamily: "system-ui, -apple-system, sans-serif" },
  teaser: { position: "absolute" as const, bottom: 80, right: 0, marginBottom: 16, maxWidth: 280 },
  teaserCard: { backgroundColor: "white", borderRadius: 24, boxShadow: "0 20px 40px rgba(0,0,0,0.15)", border: "1px solid #e2e8f0", padding: 20, position: "relative" as const },
  teaserContent: { display: "flex" as const, alignItems: "flex-start" as const, gap: 12 },
  teaserIcon: { width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" as const },
  teaserTitle: { color: "#1e293b", fontWeight: 600, fontSize: 14, marginBottom: 4 },
  teaserText: { color: "#64748b", fontSize: 12, lineHeight: 1.4 },
  teaserArrow: { position: "absolute" as const, bottom: -8, right: 32, width: 16, height: 16, backgroundColor: "white", borderRight: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0", transform: "rotate(45deg)" },
  teaserClose: { position: "absolute" as const, top: -8, right: -8, width: 24, height: 24, backgroundColor: "#f1f5f9", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: "none", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" },
  chatButton: { width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 20px 40px rgba(0,0,0,0.2)", transition: "all 0.3s ease", position: "relative" as const },
  chatWindow: { width: 384, height: 600, backgroundColor: "white", borderRadius: 24, boxShadow: "0 20px 40px rgba(0,0,0,0.15)", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column" as const, overflow: "hidden" as const },
  header: { padding: 24, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", color: "white", position: "relative" as const, overflow: "hidden" as const },
  headerContent: { display: "flex" as const, alignItems: "center" as const, justifyContent: "space-between" as const, position: "relative" as const, zIndex: 10 },
  headerLeft: { display: "flex" as const, alignItems: "center" as const, gap: 16 },
  headerIcon: { width: 48, height: 48, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" as const },
  headerTitle: { fontWeight: 700, fontSize: 18, marginBottom: 4 },
  headerStatus: { display: "flex" as const, alignItems: "center" as const, gap: 8, fontSize: 14, color: "rgba(255,255,255,0.8)" },
  closeButton: { width: 40, height: 40, borderRadius: "50%", backgroundColor: "rgba(255,255,255,0.2)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "white" },
  messagesContainer: { flex: 1, overflowY: "auto" as const, padding: 24, background: "linear-gradient(to bottom, #f8fafc, white)", display: "flex", flexDirection: "column" as const, gap: 16 },
  messageRow: { display: "flex" as const },
  messageRowUser: { justifyContent: "flex-end" as const },
  messageRowBot: { justifyContent: "flex-start" as const },
  botAvatar: { width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12, flexShrink: 0, marginTop: 4, overflow: "hidden" as const },
  userAvatar: { width: 32, height: 32, backgroundColor: "#e2e8f0", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginLeft: 12, flexShrink: 0, marginTop: 4, fontSize: 14, fontWeight: 500, color: "#64748b" },
  messageBubble: { maxWidth: "80%", padding: 16, borderRadius: 24, fontSize: 14, lineHeight: 1.5, wordWrap: "break-word" as const, overflowWrap: "break-word" as const, wordBreak: "break-word" as const },
  messageBubbleUser: { background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", color: "white", borderBottomRightRadius: 8 },
  messageBubbleBot: { backgroundColor: "white", color: "#1e293b", borderBottomLeftRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", border: "1px solid #e2e8f0" },
  messageBubbleError: { backgroundColor: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderBottomLeftRadius: 8 },
  messageTime: { fontSize: 12, opacity: 0.6, marginTop: 8, fontWeight: 500 },
  sourcesToggle: { marginTop: 12, paddingTop: 8, borderTop: "1px solid rgba(148, 163, 184, 0.2)", cursor: "pointer", userSelect: "none" as const, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#3b82f6", fontWeight: 500 },
  sourcesContent: { marginTop: 8, fontSize: 12, color: "#64748b" },
  sourceItem: { display: "flex", alignItems: "center", gap: 8, fontSize: 11, marginBottom: 4, padding: "4px 8px", backgroundColor: "#f1f5f9", borderRadius: 8 },
  sourceBadge: { backgroundColor: "#e2e8f0", color: "#64748b", padding: "2px 6px", borderRadius: 10, fontSize: 10, fontWeight: 500, marginLeft: "auto" },
  loadingContainer: { display: "flex" as const, alignItems: "flex-start" as const },
  loadingBubble: { backgroundColor: "white", color: "#1e293b", padding: 16, borderRadius: 24, borderBottomLeftRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12 },
  inputContainer: { padding: 24, backgroundColor: "white", borderTop: "1px solid #e2e8f0" },
  inputRow: { display: "flex" as const, gap: 12 },
  input: { flex: 1, padding: 16, backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 16, fontSize: 14, outline: "none" },
  sendButton: { width: 48, height: 48, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", border: "none", borderRadius: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "white", boxShadow: "0 4px 12px rgba(59, 130, 246, 0.4)" },
}

export interface ChatbotWidgetProps {
  /** "homepage" = PetRx only; "insurance" = PetRx + Healthy Paws */
  pageContext?: ChatbotPageContext
}

export function ChatbotWidget({ pageContext = "homepage" }: ChatbotWidgetProps) {
  const content = pageContext === "insurance" ? CONTENT_INSURANCE : CONTENT_HOMEPAGE
  const [isOpen, setIsOpen] = useState(false)
  const [showTeaser, setShowTeaser] = useState(true)
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, text: content.initialMessage, sender: "bot", timestamp: new Date() },
  ])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])
  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])

  const toggleSources = useCallback((messageId: number) => {
    setExpandedSources((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }, [])

  const sendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) return
    const currentInput = inputValue
    setMessages((prev) => [...prev, { id: Date.now(), text: currentInput, sender: "user", timestamp: new Date() }])
    setInputValue("")
    setIsLoading(true)
    try {
      const res = await fetch(getChatApi(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: currentInput, pageContext }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Something went wrong")
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, text: data.response, sender: "bot", timestamp: new Date(), sources: data.sources },
      ])
    } catch (err) {
      console.error("Chat error:", err)
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, text: "I'm sorry, I'm having trouble connecting right now. Please try again in a moment.", sender: "bot", timestamp: new Date(), isError: true },
      ])
    } finally {
      setIsLoading(false)
    }
  }, [inputValue, isLoading, pageContext])

  const openChat = () => { setIsOpen(true); setShowTeaser(false) }
  const closeChat = () => { setIsOpen(false); setTimeout(() => setShowTeaser(true), 5000) }
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const avatarImg = <img src={CHATBOT_AVATAR_URL} alt="PetRx Assistant" style={{ width: "100%", height: "100%", objectFit: "cover" }} />

  if (!isOpen) {
    return (
      <div style={baseStyles.container}>
        {showTeaser && (
          <div style={{ ...baseStyles.teaser }} className="chatbot-widget__teaser">
            <div style={baseStyles.teaserCard}>
              <div style={baseStyles.teaserContent}>
                <div style={baseStyles.teaserIcon}>{avatarImg}</div>
                <div style={{ flex: 1 }}>
                  <div style={baseStyles.teaserTitle}>{content.teaserTitle}</div>
                  <div style={baseStyles.teaserText}>{content.teaserText}</div>
                </div>
              </div>
              <div style={baseStyles.teaserArrow} />
              <button type="button" style={baseStyles.teaserClose} onClick={() => setShowTeaser(false)} aria-label="Close">
                <X size={12} color="#64748b" />
              </button>
            </div>
          </div>
        )}
        <button type="button" style={baseStyles.chatButton} onClick={openChat} aria-label="Open chat">
          <MessageCircle size={28} color="white" />
        </button>
      </div>
    )
  }

  return (
    <div style={baseStyles.container}>
      <div style={baseStyles.chatWindow}>
        <div style={baseStyles.header}>
          <div style={baseStyles.headerContent}>
            <div style={baseStyles.headerLeft}>
              <div style={baseStyles.headerIcon}>{avatarImg}</div>
              <div>
                <div style={baseStyles.headerTitle}>{content.headerTitle}</div>
                <div style={baseStyles.headerStatus}>
                  <div style={{ width: 8, height: 8, backgroundColor: "#10b981", borderRadius: "50%" }} className="chatbot-widget__status-dot" />
                  <span>Online & ready to help</span>
                </div>
              </div>
            </div>
            <button type="button" style={baseStyles.closeButton} onClick={closeChat} aria-label="Close chat">
              <X size={18} color="white" />
            </button>
          </div>
        </div>
        <div style={baseStyles.messagesContainer}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                ...baseStyles.messageRow,
                ...(msg.sender === "user" ? baseStyles.messageRowUser : baseStyles.messageRowBot),
              }}
            >
              {msg.sender === "bot" && <div style={baseStyles.botAvatar}>{avatarImg}</div>}
              <div
                style={{
                  ...baseStyles.messageBubble,
                  ...(msg.sender === "user" ? baseStyles.messageBubbleUser : msg.isError ? baseStyles.messageBubbleError : baseStyles.messageBubbleBot),
                }}
              >
                <div>
                  {msg.sender === "bot" ? renderMarkdown(msg.text) : msg.text}
                </div>
                {msg.sources && msg.sources.length > 0 && (
                  <div>
                    <div
                      style={baseStyles.sourcesToggle}
                      onClick={() => toggleSources(msg.id)}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "#1d4ed8" }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "#3b82f6" }}
                    >
                      <ChevronRight size={12} color="currentColor" style={{ transform: expandedSources.has(msg.id) ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }} />
                      <span>Sources ({msg.sources.length})</span>
                    </div>
                    {expandedSources.has(msg.id) && (
                      <div style={baseStyles.sourcesContent}>
                        {msg.sources.map((s, i) => (
                          <div key={i} style={baseStyles.sourceItem}>
                            <span style={{ fontWeight: 500 }}>{s.title}</span>
                            <span style={baseStyles.sourceBadge}>{Math.round(s.similarity * 100)}% match</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div style={baseStyles.messageTime}>{msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
              {msg.sender === "user" && <div style={baseStyles.userAvatar}>U</div>}
            </div>
          ))}
          {isLoading && (
            <div style={baseStyles.loadingContainer}>
              <div style={baseStyles.botAvatar}>{avatarImg}</div>
              <div style={baseStyles.loadingBubble}>
                <div style={{ width: 16, height: 16, border: "2px solid #e2e8f0", borderTop: "2px solid #3b82f6", borderRadius: "50%" }} className="chatbot-widget__loading-spinner" />
                <span>Thinking...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div style={baseStyles.inputContainer}>
          <div style={baseStyles.inputRow}>
            <input
              style={{ ...baseStyles.input, ...(isLoading ? { backgroundColor: "#f1f5f9" } : {}) }}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={content.placeholder}
              disabled={isLoading}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              style={{
                ...baseStyles.sendButton,
                ...(!inputValue.trim() || isLoading ? { opacity: 0.5, cursor: "not-allowed" } : {}),
              }}
              onClick={sendMessage}
              disabled={!inputValue.trim() || isLoading}
            >
              <Send size={18} color="white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
