import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import ChatPanel from '../components/ChatPanel';
import './MainLayout.css';

function MainLayout({ children }) {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="main-layout">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>

      {/* Floating Chat Button */}
      <button
        className="chat-fab"
        onClick={() => setChatOpen(true)}
        title="Open Claude Assistant"
      >
        <MessageSquare size={22} strokeWidth={1.5} />
      </button>

      {/* Chat Panel */}
      <ChatPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        contextType="general"
      />
    </div>
  );
}

export default MainLayout;
