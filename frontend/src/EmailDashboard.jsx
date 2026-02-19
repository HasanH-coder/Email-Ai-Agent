import { useState, useRef, useCallback, useEffect } from 'react'

// --- Mock Data ---
const gmailEmails = [
  {
    id: 1,
    sender: 'Alice Johnson',
    email: 'alice.johnson@company.com',
    subject: 'Q1 Marketing Strategy Review',
    preview: 'Hi team, I wanted to share the updated marketing strategy for Q1. Please review the attached deck and...',
    body: 'Hi team,\n\nI wanted to share the updated marketing strategy for Q1. Please review the attached deck and let me know your thoughts by Friday.\n\nKey highlights:\n- Social media budget increased by 20%\n- New influencer partnerships in the pipeline\n- Updated brand guidelines rolling out next week\n\nLet me know if you have any questions.\n\nBest,\nAlice',
    time: '10:32 AM',
    date: 'Feb 14, 2026',
    read: false,
    starred: false,
    avatar: 'AJ',
    avatarColor: 'bg-indigo-500',
    provider: 'gmail',
  },
  {
    id: 2,
    sender: 'David Kim',
    email: 'david.kim@startup.io',
    subject: 'Follow-up: Partnership Proposal',
    preview: 'Thanks for taking the time to meet yesterday. As discussed, I have attached the partnership proposal for...',
    body: 'Hi,\n\nThanks for taking the time to meet yesterday. As discussed, I have attached the partnership proposal for your review.\n\nThe main terms include:\n- Revenue share: 70/30 split\n- Minimum commitment: 6 months\n- Dedicated support channel\n- Quarterly business reviews\n\nI believe this partnership could be mutually beneficial. Happy to hop on a call to discuss further.\n\nRegards,\nDavid',
    time: '9:15 AM',
    date: 'Feb 14, 2026',
    read: false,
    starred: true,
    avatar: 'DK',
    avatarColor: 'bg-emerald-500',
    provider: 'gmail',
  },
  {
    id: 3,
    sender: 'Sarah Chen',
    email: 'sarah.chen@design.co',
    subject: 'New Design System Components',
    preview: 'Hey! The new component library is ready for review. I have uploaded the Figma file and the Storybook link...',
    body: 'Hey!\n\nThe new component library is ready for review. I have uploaded the Figma file and the Storybook link is live.\n\nNew components include:\n- Updated button variants\n- Card component with 3 sizes\n- Modal system with animations\n- Toast notifications\n\nFigma: https://figma.com/file/example\nStorybook: https://storybook.design.co\n\nLet me know what you think!\n\nCheers,\nSarah',
    time: 'Yesterday',
    date: 'Feb 13, 2026',
    read: true,
    starred: false,
    avatar: 'SC',
    avatarColor: 'bg-rose-500',
    provider: 'gmail',
  },
  {
    id: 4,
    sender: 'Emily Watson',
    email: 'emily.watson@hr.org',
    subject: 'Team Offsite Planning - March',
    preview: 'Hi everyone! Excited to announce that we are planning a team offsite for mid-March. Please fill out the...',
    body: 'Hi everyone!\n\nExcited to announce that we are planning a team offsite for mid-March. Please fill out the preference survey by end of this week.\n\nOptions being considered:\n- Lake Tahoe retreat (3 days)\n- San Francisco workshop (2 days)\n- Virtual + local dinner combo\n\nSurvey link: https://forms.example/offsite-2026\n\nBudget per person: $500\n\nLooking forward to it!\n\nBest,\nEmily',
    time: 'Mon',
    date: 'Feb 10, 2026',
    read: true,
    starred: false,
    avatar: 'EW',
    avatarColor: 'bg-sky-500',
    provider: 'gmail',
  },
]

const outlookEmails = [
  {
    id: 101,
    sender: 'Mike Peters',
    email: 'mike.peters@engineering.dev',
    subject: 'Deployment Pipeline Update',
    preview: 'Quick heads up: we are migrating the CI/CD pipeline to GitHub Actions this weekend. No downtime expected...',
    body: 'Quick heads up:\n\nWe are migrating the CI/CD pipeline to GitHub Actions this weekend. No downtime is expected, but please avoid merging to main between Saturday 10 PM and Sunday 6 AM.\n\nChanges:\n- Moving from Jenkins to GitHub Actions\n- Build times expected to improve by 40%\n- Auto-rollback on failed health checks\n- Slack notifications for deployment status\n\nDocs are updated here: https://docs.internal/ci-migration\n\nThanks,\nMike',
    time: '11:00 AM',
    date: 'Feb 14, 2026',
    read: false,
    starred: true,
    avatar: 'MP',
    avatarColor: 'bg-amber-500',
    provider: 'outlook',
  },
  {
    id: 102,
    sender: 'Liam Brooks',
    email: 'liam.brooks@sales.com',
    subject: 'Client Demo Feedback',
    preview: 'Great news! The client demo went really well. They were especially impressed with the AI features and...',
    body: 'Great news!\n\nThe client demo went really well. They were especially impressed with the AI features and the dashboard analytics.\n\nKey takeaways:\n- They want a custom integration with their CRM\n- Timeline: kick-off in 2 weeks\n- Budget approved for Phase 1\n- Follow-up meeting scheduled for Thursday\n\nI will send over the detailed notes from the meeting shortly.\n\nCheers,\nLiam',
    time: 'Yesterday',
    date: 'Feb 13, 2026',
    read: false,
    starred: false,
    avatar: 'LB',
    avatarColor: 'bg-violet-500',
    provider: 'outlook',
  },
  {
    id: 103,
    sender: 'Rachel Nguyen',
    email: 'rachel.nguyen@finance.co',
    subject: 'Budget Approval for Q2',
    preview: 'Hi, the Q2 budget has been reviewed and approved by the finance committee. Please find the breakdown...',
    body: 'Hi,\n\nThe Q2 budget has been reviewed and approved by the finance committee. Please find the breakdown below:\n\n- Engineering: $120,000\n- Marketing: $85,000\n- Operations: $60,000\n- R&D: $95,000\n\nPlease submit your itemized spending plans by March 1st.\n\nBest,\nRachel',
    time: 'Mon',
    date: 'Feb 10, 2026',
    read: true,
    starred: false,
    avatar: 'RN',
    avatarColor: 'bg-teal-500',
    provider: 'outlook',
  },
]

const initialDrafts = [
  {
    id: 'd1',
    to: 'alice.johnson@company.com',
    subject: 'Re: Q1 Marketing Strategy Review',
    body: 'Hi Alice,\n\nThanks for sharing. I have a few thoughts on the social media budget allocation. I think we should consider redirecting some funds toward content marketing as it showed stronger ROI last quarter.\n\nAlso, regarding the influencer partnerships - could we get a list of potential candidates to review before finalizing?\n\nLet me know when you are free to discuss.\n\nBest regards',
    time: 'Feb 13, 2026',
  },
  {
    id: 'd2',
    to: 'team@company.com',
    subject: 'Weekly Standup Notes',
    body: 'Team,\n\nHere are the notes from this week:\n\n- Frontend: Completed dashboard redesign\n- Backend: API v2 migration at 80%\n- DevOps: New monitoring alerts set up\n\nBlockers:\n- Waiting on design review for mobile layouts\n- Need access to staging environment\n\nNext week focus:\n- Finalize API migration\n- Begin QA testing',
    time: 'Feb 12, 2026',
  },
]

// --- Icons ---
function InboxIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-17.5 0V6.75A2.25 2.25 0 014.5 4.5h15a2.25 2.25 0 012.25 2.25v6.75m-19.5 0v4.5A2.25 2.25 0 004.5 19.5h15a2.25 2.25 0 002.25-2.25v-4.5" />
    </svg>
  )
}

function DraftIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}

function SentIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.27 3.13a59.76 59.76 0 0 1 18.22 8.87 59.77 59.77 0 0 1-18.22 8.88L6 12Zm0 0h7.5" />
    </svg>
  )
}

function SettingsIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function SignOutIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
  )
}

function SearchIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  )
}

function StarIcon({ className, filled }) {
  return filled ? (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" />
    </svg>
  ) : (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </svg>
  )
}

function PaperclipIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
    </svg>
  )
}

function PlusIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function SparklesIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  )
}

function XIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function SendIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  )
}

function PencilIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  )
}

function TrashIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  )
}

function CheckIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

function ImageIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75V6.75A2.25 2.25 0 014.5 4.5h15a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-15A2.25 2.25 0 012.25 15.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 14.25 4.5-4.5a1.5 1.5 0 012.121 0l4.5 4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.25 12.75 1.5-1.5a1.5 1.5 0 012.121 0l2.379 2.379" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 8.25h.008v.008H8.25V8.25z" />
    </svg>
  )
}

function FolderIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 7.5A2.25 2.25 0 016 5.25h4.19c.597 0 1.17.237 1.591.659l.81.81c.422.422.994.659 1.591.659H18a2.25 2.25 0 012.25 2.25v6.75A2.25 2.25 0 0118 18.75H6a2.25 2.25 0 01-2.25-2.25V7.5z" />
    </svg>
  )
}

function AttachmentMenu({ isOpen, anchorRef, onClose, onSelect }) {
  const menuRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    function handleOutsideClick(e) {
      if (!menuRef.current || !anchorRef?.current) return
      if (menuRef.current.contains(e.target) || anchorRef.current.contains(e.target)) return
      onClose()
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [isOpen, onClose, anchorRef])

  if (!isOpen || !anchorRef?.current) return null

  const rect = anchorRef.current.getBoundingClientRect()

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-56 rounded-xl border border-slate-200 bg-white shadow-xl p-2"
      style={{ top: rect.top - 166, left: rect.left }}
      role="menu"
      aria-label="Attachment options"
    >
      <button
        onClick={() => onSelect('photos')}
        className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-slate-700 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <ImageIcon className="w-4 h-4 text-slate-500" />
        Photos and videos
      </button>
      <button
        onClick={() => onSelect('files')}
        className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-slate-700 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <FolderIcon className="w-4 h-4 text-slate-500" />
        Other files
      </button>
      <button
        onClick={() => onSelect('attachment')}
        className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-slate-700 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <PaperclipIcon className="w-4 h-4 text-slate-500" />
        Traditional attachment
      </button>
    </div>
  )
}


// --- Reusable Confirm Modal ---
function ConfirmModal({ isOpen, title, message, confirmLabel, confirmClass, onCancel, onConfirm }) {
  const backdropRef = useRef(null)
  const handleBackdrop = useCallback((e) => {
    if (e.target === backdropRef.current) onCancel()
  }, [onCancel])

  if (!isOpen) return null
  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-[fadeScaleIn_0.15s_ease-out]">
        <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
        <p className="text-sm text-slate-500 mb-6">{message}</p>
        <div className="flex items-center gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${confirmClass || 'text-white bg-red-600 hover:bg-red-700'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}


// --- Connect Account Modal ---
function ConnectModal({ isOpen, provider, onCancel, onConnect }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const backdropRef = useRef(null)

  function handleBackdrop(e) {
    if (e.target === backdropRef.current) onCancel()
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) return
    onConnect(email.trim())
    setEmail('')
    setPassword('')
  }

  function handleCancel() {
    setEmail('')
    setPassword('')
    onCancel()
  }

  if (!isOpen) return null

  const providerName = provider === 'gmail' ? 'Gmail' : 'Outlook'
  const providerColor = provider === 'gmail' ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-600'

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={'Connect ' + providerName}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[fadeScaleIn_0.15s_ease-out]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className={'w-9 h-9 rounded-lg flex items-center justify-center ' + providerColor}>
            {provider === 'gmail' ? (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 7.387v10.478c0 .23-.08.424-.238.576-.16.154-.352.23-.578.23h-8.26v-6.08L16.91 14l1.957-1.41v-2.534l-1.957 1.38L12.924 8.6V7.157h10.26c.226 0 .418.08.578.233.158.152.238.35.238.576v-.58zM14.078 5.07v14.64L0 17.488V3.293l14.078 1.778zm-2.89 4.252c-.533-.754-1.268-1.13-2.206-1.13-.918 0-1.654.386-2.2 1.16-.55.773-.822 1.772-.822 2.997 0 1.174.264 2.127.793 2.86.53.734 1.248 1.1 2.157 1.1.963 0 1.72-.37 2.27-1.113.55-.743.823-1.733.823-2.97 0-1.28-.272-2.284-.816-3.018v.114zm-1.16 5.057c-.267.477-.648.716-1.143.716-.486 0-.87-.245-1.15-.735-.28-.49-.42-1.14-.42-1.948 0-.84.14-1.506.42-1.998.282-.49.67-.737 1.168-.737.483 0 .863.24 1.142.72.278.48.418 1.142.418 1.985 0 .844-.145 1.52-.435 1.997z" />
              </svg>
            )}
          </div>
          <h3 className="text-base font-bold text-slate-900">{'Connect ' + providerName}</h3>
        </div>
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-3">
            <div>
              <label htmlFor="connect-email" className="block text-xs font-medium text-slate-500 mb-1">Email</label>
              <input
                id="connect-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={'you@' + (provider === 'gmail' ? 'gmail.com' : 'outlook.com')}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="connect-password" className="block text-xs font-medium text-slate-500 mb-1">Password</label>
              <input
                id="connect-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              />
            </div>
          </div>
          <div className="flex items-center gap-3 justify-end mt-5">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors cursor-pointer"
            >
              Connect
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


// --- Compose Modal (also used for editing drafts) ---
function ComposeModal({ isOpen, onClose, signature, useSignature, initialData, onSaveDraft, onSendEmail }) {
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [attachments, setAttachments] = useState([])
  const [step, setStep] = useState('compose') // compose | review
  const [generatedBody, setGeneratedBody] = useState('')
  const [editMode, setEditMode] = useState('manual') // manual | ai
  const [aiEditPrompt, setAiEditPrompt] = useState('')
  const [manualBody, setManualBody] = useState('')
  const [composeMessage, setComposeMessage] = useState('')
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const backdropRef = useRef(null)
  const attachmentButtonRef = useRef(null)
  const isEditing = !!initialData
  const hasRecipient = to.trim().length > 0
  const hasPrompt = aiPrompt.trim().length > 0
  const canGenerateInNewEmail = hasRecipient && hasPrompt
  const canGenerateInEditMode = hasRecipient
  const canGenerate = isEditing ? canGenerateInEditMode : canGenerateInNewEmail

  useEffect(() => {
    if (!isOpen) return
    if (initialData) {
      setTo(initialData.to || '')
      setCc('')
      setSubject(initialData.subject || '')
      setManualBody(initialData.body || '')
      setAiPrompt(initialData.body || '')
      setEditMode('manual')
      setStep('compose')
      setGeneratedBody('')
      setAiEditPrompt('')
      setComposeMessage('')
    } else {
      setTo('')
      setCc('')
      setSubject('')
      setAiPrompt('')
      setAttachments([])
      setStep('compose')
      setGeneratedBody('')
      setEditMode('manual')
      setAiEditPrompt('')
      setManualBody('')
      setComposeMessage('')
    }
  }, [isOpen, initialData])

  function handleBackdrop(e) {
    if (e.target === backdropRef.current) handleClose()
  }

  function handleAddAttachment(type = 'attachment') {
    const namesByType = {
      photos: ['photo-1.jpg', 'vacation.mp4', 'portrait.png'],
      files: ['report.pdf', 'presentation.pptx', 'data.xlsx'],
      attachment: ['notes.docx', 'attachment.zip', 'summary.txt'],
    }
    const names = namesByType[type] || namesByType.attachment
    const name = names[attachments.length % names.length]
    setAttachments((prev) => [...prev, { id: Date.now(), name }])
  }

  function handleAttachmentOptionSelect(option) {
    handleAddAttachment(option)
    setAttachmentMenuOpen(false)
  }

  function handleRemoveAttachment(id) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  function getSignatureText() {
    if (!useSignature || !signature) return ''
    return '\n\n' + signature
  }

  function buildGeneratedBodyFromPrompt(promptText) {
    return `Dear recipient,\n\nThank you for your message. I wanted to follow up regarding ${promptText.toLowerCase().slice(0, 80)}.\n\nI have reviewed the details and would like to share my thoughts:\n\n1. The proposed timeline looks reasonable and achievable.\n2. I suggest we schedule a follow-up meeting to discuss the specifics.\n3. Please let me know if you need any additional information from my end.\n\nI look forward to hearing from you.${getSignatureText() || '\n\nBest regards'}`
  }

  function handleGenerate() {
    if (!canGenerate) return
    const prompt = (isEditing && editMode === 'manual' ? manualBody : aiPrompt).trim() || subject || 'a professional email'
    const body = buildGeneratedBodyFromPrompt(prompt)
    setGeneratedBody(body)
    setStep('review')
    setComposeMessage('')
  }

  function handleGenerateAndSend() {
    if (!canGenerateInNewEmail) return
    const prompt = (isEditing && editMode === 'manual' ? manualBody : aiPrompt).trim() || subject || 'a professional email'
    const body = buildGeneratedBodyFromPrompt(prompt)
    if (onSendEmail) {
      onSendEmail({
        to,
        cc,
        subject,
        body,
        draftId: isEditing ? initialData?.id : null,
      })
    }
    handleClose()
  }

  function handleAiRewrite() {
    if (!hasRecipient) {
      setComposeMessage('Enter a recipient email in the To field first.')
      return
    }
    const prompt = aiEditPrompt.trim() || 'more professional and concise'
    const body = `Dear recipient,\n\nI am writing to follow up on our previous correspondence. After careful consideration, I would like to address the following points:\n\nRegarding "${prompt}":\n\n1. I have thoroughly reviewed the materials and believe we are well-positioned to move forward.\n2. Our team has prepared a comprehensive analysis that addresses the key concerns.\n3. I would appreciate the opportunity to discuss this further at your earliest convenience.\n\nPlease do not hesitate to reach out if you have any questions.${getSignatureText() || '\n\nBest regards'}`
    setManualBody(body)
    setAiEditPrompt('')
    setComposeMessage('')
  }

  function handleSend() {
    if (onSendEmail) {
      onSendEmail({
        to,
        cc,
        subject,
        body: generatedBody || manualBody,
        draftId: isEditing ? initialData?.id : null,
      })
    }
    handleClose()
  }

  function handleEdit() {
    setStep('compose')
    setManualBody(generatedBody)
    setEditMode('manual')
  }

  function handleClose() {
    onClose()
    setTo('')
    setCc('')
    setSubject('')
    setAiPrompt('')
    setAttachments([])
    setStep('compose')
    setGeneratedBody('')
    setEditMode('manual')
    setAiEditPrompt('')
    setManualBody('')
    setComposeMessage('')
    setAttachmentMenuOpen(false)
  }

  if (!isOpen) return null

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? 'Edit draft' : 'Compose email'}
    >
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${step === 'review' ? 'max-w-5xl' : 'max-w-4xl'} max-h-[94vh] flex flex-col overflow-hidden animate-[fadeScaleIn_0.15s_ease-out]`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h3 className="text-base font-bold text-slate-900">
            {step === 'review' ? 'Review Email' : isEditing ? 'Edit Draft' : 'New Email'}
          </h3>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {step === 'compose' ? (
          <div className="p-6 overflow-y-auto flex-1">
            <div className="space-y-3">
              <div>
                <label htmlFor="compose-to" className="block text-xs font-medium text-slate-500 mb-1">To</label>
                <input
                  id="compose-to"
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              {!isEditing && (
                <div>
                  <label htmlFor="compose-cc" className="block text-xs font-medium text-slate-500 mb-1">CC</label>
                  <input
                    id="compose-cc"
                    type="email"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="cc@example.com"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              )}
              <div>
                <label htmlFor="compose-subject" className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
                <input
                  id="compose-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              {/* Edit mode toggle for draft editing */}
              {isEditing && (
                <div>
                  <div className="flex items-center gap-1 mb-2 bg-slate-100 rounded-lg p-0.5 w-fit">
                    <button
                      onClick={() => setEditMode('manual')}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                        editMode === 'manual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Edit manually
                    </button>
                    <button
                      onClick={() => setEditMode('ai')}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1 ${
                        editMode === 'ai' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <SparklesIcon className="w-3.5 h-3.5" />
                      Let AI edit
                    </button>
                  </div>

                  {editMode === 'manual' ? (
                    <textarea
                      rows={16}
                      value={manualBody}
                      onChange={(e) => setManualBody(e.target.value)}
                      placeholder="Write your email body..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                    />
                  ) : (
                    <div className="space-y-2">
                      <div className="bg-slate-50 rounded-xl p-3 max-h-32 overflow-y-auto">
                        <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans leading-relaxed">{manualBody}</pre>
                      </div>
                      <textarea
                        rows={2}
                        value={aiEditPrompt}
                        onChange={(e) => setAiEditPrompt(e.target.value)}
                        placeholder="e.g. Make it more formal and add a call to action..."
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                      />
                      <button
                        onClick={handleAiRewrite}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-100 rounded-lg hover:bg-indigo-200 transition-colors cursor-pointer"
                      >
                        <SparklesIcon className="w-3.5 h-3.5" />
                        Generate from Prompt
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* AI prompt for new emails */}
              {!isEditing && (
                <div>
                  <label htmlFor="compose-prompt" className="block text-xs font-medium text-slate-500 mb-1">Tell the AI what to write</label>
                  <textarea
                    id="compose-prompt"
                    rows={12}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. Write a follow-up email about the Q1 budget proposal..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                </div>
              )}

              {/* Attachments */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 text-xs font-medium text-slate-700">
                      <PaperclipIcon className="w-3 h-3" />
                      {a.name}
                      <button
                        onClick={() => handleRemoveAttachment(a.id)}
                        className="text-slate-400 hover:text-slate-600 cursor-pointer"
                        aria-label={'Remove ' + a.name}
                      >
                        <XIcon className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between mt-5">
              <button
                ref={attachmentButtonRef}
                onClick={() => setAttachmentMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <PaperclipIcon className="w-4 h-4" />
                Attach file
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                {isEditing && editMode === 'manual' && (
                  <button
                    onClick={() => {
                      if (onSaveDraft) onSaveDraft({ to, subject, body: manualBody })
                      handleClose()
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-200 rounded-xl hover:bg-slate-300 transition-colors cursor-pointer"
                  >
                    Save Draft
                  </button>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${
                    canGenerate
                      ? 'text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer'
                      : 'text-slate-400 bg-slate-200 cursor-not-allowed'
                  }`}
                >
                  <SparklesIcon className="w-4 h-4" />
                  Generate with AI
                </button>
                {!isEditing && (
                  <button
                    onClick={handleGenerateAndSend}
                    disabled={!canGenerateInNewEmail}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${
                      canGenerateInNewEmail
                        ? 'text-white bg-slate-700 hover:bg-slate-800 cursor-pointer'
                        : 'text-slate-400 bg-slate-200 cursor-not-allowed'
                    }`}
                  >
                    <SendIcon className="w-4 h-4" />
                    Generate & Send
                  </button>
                )}
              </div>
            </div>
            {!canGenerateInNewEmail && !isEditing && (
              <p className="mt-3 text-xs font-medium text-red-600">
                Enter a recipient in To and a prompt to enable Generate and Generate & Send.
              </p>
            )}
            {composeMessage && (
              <p className="mt-3 text-xs font-medium text-red-600">
                {composeMessage}
              </p>
            )}
            <AttachmentMenu
              isOpen={attachmentMenuOpen}
              anchorRef={attachmentButtonRef}
              onClose={() => setAttachmentMenuOpen(false)}
              onSelect={handleAttachmentOptionSelect}
            />
          </div>
        ) : (
          /* Review step */
          <div className="p-6 overflow-y-auto flex-1">
            {to && (
              <div className="mb-3">
                <span className="text-xs font-medium text-slate-500">To: </span>
                <span className="text-sm text-slate-900">{to}</span>
                {cc && (
                  <>
                    <span className="text-xs font-medium text-slate-500 ml-3">CC: </span>
                    <span className="text-sm text-slate-900">{cc}</span>
                  </>
                )}
              </div>
            )}
            {subject && (
              <div className="mb-3">
                <span className="text-xs font-medium text-slate-500">Subject: </span>
                <span className="text-sm font-medium text-slate-900">{subject}</span>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {attachments.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 text-xs font-medium text-slate-600">
                    <PaperclipIcon className="w-3 h-3" />
                    {a.name}
                  </span>
                ))}
              </div>
            )}
            <div className="bg-slate-50 rounded-xl p-4 mb-4">
              <textarea
                rows={18}
                value={generatedBody}
                onChange={(e) => setGeneratedBody(e.target.value)}
                className="w-full text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed bg-transparent focus:outline-none resize-none"
              />
            </div>
            <div className="mb-5">
              <label htmlFor="review-regenerate-prompt" className="block text-xs font-medium text-slate-500 mb-1">
                Modify with a new prompt
              </label>
              <div className="flex items-start gap-2">
                <textarea
                  id="review-regenerate-prompt"
                  rows={3}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Type a new prompt, then click Regenerate..."
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                />
                <button
                  disabled={!canGenerateInNewEmail}
                  onClick={() => {
                    if (!canGenerateInNewEmail) {
                      setComposeMessage('Enter a recipient in To and a prompt before regenerating.')
                      return
                    }
                    const body = buildGeneratedBodyFromPrompt(aiPrompt.trim())
                    setGeneratedBody(body)
                    setComposeMessage('')
                  }}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${
                    canGenerateInNewEmail
                      ? 'text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer'
                      : 'text-slate-400 bg-slate-200 cursor-not-allowed'
                  }`}
                >
                  <SparklesIcon className="w-4 h-4" />
                  Regenerate
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={handleEdit}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <PencilIcon className="w-4 h-4" />
                Edit
              </button>
              <button
                onClick={handleSend}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors cursor-pointer"
              >
                <SendIcon className="w-4 h-4" />
                Send Email
              </button>
            </div>
            {composeMessage && (
              <p className="mt-3 text-xs font-medium text-red-600">{composeMessage}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}


// --- Main Dashboard ---
export default function EmailDashboard({ onSignOut }) {
  const [gmailEmailState, setGmailEmails] = useState(gmailEmails)
  const [outlookEmailState, setOutlookEmails] = useState(outlookEmails)
  const [drafts, setDrafts] = useState(initialDrafts)
  const [sentEmails, setSentEmails] = useState([])
  const [emailThreads, setEmailThreads] = useState({})
  const [selectedSentEmailId, setSelectedSentEmailId] = useState(null)
  const [selectedEmailId, setSelectedEmailId] = useState(gmailEmails[0].id)
  const [activeFilter, setActiveFilter] = useState('all')
  const [activePage, setActivePage] = useState('inbox')
  const [activeProvider, setActiveProvider] = useState('gmail')
  const [searchQuery, setSearchQuery] = useState('')
  const [showSignOutModal, setShowSignOutModal] = useState(false)
  const [showComposeModal, setShowComposeModal] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileShowDetail, setMobileShowDetail] = useState(false)

  // Settings state
  const [signature, setSignature] = useState('')
  const [useSignature, setUseSignature] = useState(true)
  const [connectedAccounts, setConnectedAccounts] = useState({ gmail: true, outlook: false })
  const [connectedEmails, setConnectedEmails] = useState({ gmail: 'user@gmail.com', outlook: '' })

  // Connect modal state
  const [connectModal, setConnectModal] = useState({ open: false, provider: null, fromInbox: false })
  const [disconnectModal, setDisconnectModal] = useState({ open: false, provider: null })
  const [directSendModal, setDirectSendModal] = useState({ open: false, payload: null })

  // Draft editing
  const [editingDraft, setEditingDraft] = useState(null)
  const [deletingDraftId, setDeletingDraftId] = useState(null)

  // AI assistant state
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGeneratedEmail, setAiGeneratedEmail] = useState('')
  const [aiGeneratedMeta, setAiGeneratedMeta] = useState(null)
  const [aiActionMessage, setAiActionMessage] = useState('')
  const [aiActionTone, setAiActionTone] = useState('error')

  const isActiveProviderConnected = connectedAccounts[activeProvider]
  const currentEmails = isActiveProviderConnected
    ? (activeProvider === 'gmail' ? gmailEmailState : outlookEmailState)
    : []
  const setCurrentEmails = activeProvider === 'gmail' ? setGmailEmails : setOutlookEmails
  const selectedEmail = currentEmails.find((e) => e.id === selectedEmailId) || currentEmails[0]

  const gmailUnread = gmailEmailState.filter((e) => !e.read).length
  const outlookUnread = outlookEmailState.filter((e) => !e.read).length
  const totalUnread = gmailUnread + outlookUnread

  function handleSelectEmail(id) {
    setSelectedEmailId(id)
    setCurrentEmails((prev) => prev.map((e) => (e.id === id ? { ...e, read: true } : e)))
    setMobileShowDetail(true)
    setAiPrompt('')
    setAiGeneratedEmail('')
    setAiGeneratedMeta(null)
    setAiActionMessage('')
    setAiActionTone('error')
  }

  function handleToggleStar(id, e) {
    if (e) e.stopPropagation()
    setCurrentEmails((prev) => prev.map((em) => (em.id === id ? { ...em, starred: !em.starred } : em)))
  }

  function getFilteredEmails() {
    let filtered = currentEmails
    if (activeFilter === 'unread') filtered = filtered.filter((e) => !e.read)
    if (activeFilter === 'starred') filtered = filtered.filter((e) => e.starred)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (e) =>
          e.sender.toLowerCase().includes(q) ||
          e.subject.toLowerCase().includes(q) ||
          e.preview.toLowerCase().includes(q)
      )
    }
    return filtered
  }

  function handleProviderSwitch(provider) {
    if (!connectedAccounts[provider]) {
      setConnectModal({ open: true, provider, fromInbox: true })
      return
    }
    setActiveProvider(provider)
    const providerEmails = provider === 'gmail' ? gmailEmailState : outlookEmailState
    if (providerEmails.length > 0) {
      setSelectedEmailId(providerEmails[0].id)
    }
    setActiveFilter('all')
    setMobileShowDetail(false)
  }

  function handleConnect(provider, email) {
    setConnectedAccounts((prev) => ({ ...prev, [provider]: true }))
    setConnectedEmails((prev) => ({ ...prev, [provider]: email }))
    if (connectModal.fromInbox) {
      setActiveProvider(provider)
      const providerEmails = provider === 'gmail' ? gmailEmailState : outlookEmailState
      if (providerEmails.length > 0) {
        setSelectedEmailId(providerEmails[0].id)
      }
      setActiveFilter('all')
      setMobileShowDetail(false)
    }
    setConnectModal({ open: false, provider: null, fromInbox: false })
  }

  function handleDisconnect(provider) {
    setConnectedAccounts((prev) => ({ ...prev, [provider]: false }))
    setConnectedEmails((prev) => ({ ...prev, [provider]: '' }))
    if (activeProvider === provider) {
      const other = provider === 'gmail' ? 'outlook' : 'gmail'
      if (connectedAccounts[other]) {
        setActiveProvider(other)
        const otherEmails = other === 'gmail' ? gmailEmailState : outlookEmailState
        if (otherEmails.length > 0) setSelectedEmailId(otherEmails[0].id)
      }
    }
  }

  function handleDeleteDraft(id) {
    setDrafts((prev) => prev.filter((d) => d.id !== id))
    setDeletingDraftId(null)
  }

  function handleSaveDraft(data) {
    if (!editingDraft) return
    setDrafts((prev) =>
      prev.map((d) => (d.id === editingDraft.id ? { ...d, ...data } : d))
    )
    setEditingDraft(null)
  }

  function handleSendEmail(data) {
    const now = new Date()
    const provider = data.provider || activeProvider
    const threadRootId = data.threadRootId || data.replyToId || null
    const sentEmail = {
      id: 's' + now.getTime(),
      to: (data.to || '').trim() || 'recipient@example.com',
      cc: (data.cc || '').trim(),
      subject: (data.subject || '').trim() || '(No Subject)',
      body: (data.body || '').trim(),
      provider,
      threadRootId,
      replyToId: data.replyToId || null,
      time: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    }
    setSentEmails((prev) => [sentEmail, ...prev])
    setSelectedSentEmailId(sentEmail.id)

    const inboxEmail = {
      id: now.getTime(),
      sender: 'You',
      email: connectedEmails[provider] || 'you@example.com',
      subject: sentEmail.subject,
      preview: sentEmail.body.slice(0, 110),
      body: sentEmail.body,
      time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      read: true,
      starred: false,
      avatar: 'U',
      avatarColor: 'bg-indigo-500',
      provider,
      threadRootId,
      replyToId: data.replyToId || null,
    }

    if (provider === 'gmail') {
      setGmailEmails((prev) => [inboxEmail, ...prev])
    } else {
      setOutlookEmails((prev) => [inboxEmail, ...prev])
    }

    if (threadRootId) {
      const threadReply = {
        id: inboxEmail.id,
        from: 'You',
        to: sentEmail.to,
        body: sentEmail.body,
        date: inboxEmail.date,
        time: inboxEmail.time,
      }
      setEmailThreads((prev) => ({
        ...prev,
        [threadRootId]: [...(prev[threadRootId] || []), threadReply],
      }))
    }

    if (data.draftId) {
      setDrafts((prev) => prev.filter((d) => d.id !== data.draftId))
    }
  }

  function buildInboxReply(promptText) {
    if (!selectedEmail) return null
    const generatedReply = `Hi ${selectedEmail.sender.split(' ')[0]},\n\nThanks for your email. I am following up regarding ${promptText}.\n\nI reviewed everything and we can move forward. Let me know if you want me to share more details.\n\nBest regards`
    const body = effectiveSignature ? `${generatedReply}\n\n${effectiveSignature}` : generatedReply
    return {
      to: selectedEmail.email,
      subject: `Re: ${selectedEmail.subject}`,
      body,
      provider: selectedEmail.provider || activeProvider,
      replyToId: selectedEmail.id,
      threadRootId: selectedEmail.threadRootId || selectedEmail.id,
    }
  }

  function saveDraftFromGeneratedEmail(payload) {
    const now = new Date()
    const draft = {
      id: 'd' + now.getTime(),
      to: payload.to,
      subject: payload.subject,
      body: payload.body,
      time: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    }
    setDrafts((prev) => [draft, ...prev])
    return draft.id
  }

  function handleInboxGenerate() {
    if (!aiPrompt.trim()) {
      setAiActionMessage('Please type a prompt first before you can generate or send the email.')
      setAiActionTone('error')
      return
    }
    if (!selectedEmail) {
      setAiActionMessage('Please select an email first.')
      setAiActionTone('error')
      return
    }
    const payload = buildInboxReply(aiPrompt.trim())
    if (!payload) return

    const draftId = saveDraftFromGeneratedEmail(payload)
    setAiGeneratedEmail(payload.body)
    setAiGeneratedMeta({
      to: payload.to,
      subject: payload.subject,
      provider: payload.provider,
      replyToId: payload.replyToId,
      threadRootId: payload.threadRootId,
      draftId,
    })
    setAiActionMessage('Email generated and saved to Drafts.')
    setAiActionTone('success')
  }

  function handleInboxPromptChange(value) {
    setAiPrompt(value)
    if (aiActionMessage) {
      setAiActionMessage('')
      setAiActionTone('error')
    }
  }

  function handleGeneratedEmailChange(value) {
    setAiGeneratedEmail(value)
    if (aiActionMessage) {
      setAiActionMessage('')
      setAiActionTone('error')
    }
  }

  function handleRequestDirectSend() {
    let payload = null

    if (aiGeneratedEmail.trim() && aiGeneratedMeta) {
      payload = {
        to: aiGeneratedMeta.to,
        subject: aiGeneratedMeta.subject,
        body: aiGeneratedEmail.trim(),
        provider: aiGeneratedMeta.provider,
        replyToId: aiGeneratedMeta.replyToId,
        threadRootId: aiGeneratedMeta.threadRootId,
        draftId: aiGeneratedMeta.draftId || null,
      }
    } else {
      const prompt = aiPrompt.trim()
      if (!prompt) {
        setAiActionMessage('Please type a prompt first before you can generate or send the email.')
        setAiActionTone('error')
        return
      }
      if (!selectedEmail) {
        setAiActionMessage('Please select an email first.')
        setAiActionTone('error')
        return
      }
      payload = buildInboxReply(prompt)
    }

    if (!payload) {
      setAiActionMessage('Please type a prompt first before you can generate or send the email.')
      setAiActionTone('error')
      return
    }

    setAiActionMessage('')

    setDirectSendModal({
      open: true,
      payload,
    })
  }

  function handleSendGeneratedFromExpanded() {
    if (!aiGeneratedEmail.trim() || !aiGeneratedMeta) {
      setAiActionMessage('Generate an email first before sending.')
      setAiActionTone('error')
      return
    }

    handleSendEmail({
      to: aiGeneratedMeta.to,
      subject: aiGeneratedMeta.subject,
      body: aiGeneratedEmail.trim(),
      provider: aiGeneratedMeta.provider,
      replyToId: aiGeneratedMeta.replyToId,
      threadRootId: aiGeneratedMeta.threadRootId,
      draftId: aiGeneratedMeta.draftId || null,
    })

    setAiPrompt('')
    setAiGeneratedEmail('')
    setAiGeneratedMeta(null)
    setAiActionMessage('Email sent.')
    setAiActionTone('success')
  }

  const filteredEmails = getFilteredEmails()
  const selectedThreadRootId = selectedEmail ? (selectedEmail.threadRootId || selectedEmail.id) : null
  const selectedThreadReplies = selectedThreadRootId ? (emailThreads[selectedThreadRootId] || []) : []

  const navItems = [
    { id: 'inbox', label: 'Inbox', icon: InboxIcon, badge: totalUnread },
    { id: 'drafts', label: 'Drafts', icon: DraftIcon, badge: drafts.length },
    { id: 'sent', label: 'Sent', icon: SentIcon, badge: sentEmails.length },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ]

  const effectiveSignature = useSignature ? signature : ''

  return (
    <div className="h-screen flex bg-slate-50 overflow-hidden">
      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-100 shrink-0">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <span className="text-lg font-bold text-slate-900">MailPilot</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activePage === item.id
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActivePage(item.id)
                  setMobileSidebarOpen(false)
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge > 0 && (
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Sign Out */}
        <div className="px-3 pb-4 mt-auto">
          <button
            onClick={() => setShowSignOutModal(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
          >
            <SignOutIcon className="w-5 h-5 shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center gap-4 px-4 lg:px-6 shrink-0">
          {/* Mobile menu */}
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
            </svg>
          </button>

          {/* Search */}
          <div className="flex-1 max-w-md relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search emails..."
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white transition-all"
            />
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <button
              onClick={() => {
                setEditingDraft(null)
                setShowComposeModal(true)
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors cursor-pointer shadow-md shadow-indigo-200"
            >
              <PlusIcon className="w-4 h-4" />
              <span className="hidden sm:inline">New Email</span>
            </button>

            {/* Avatar */}
            <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-bold text-indigo-600">
              U
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-hidden">
          {activePage === 'inbox' && (
            <InboxPage
              emails={filteredEmails}
              selectedEmail={selectedEmail}
              selectedEmailId={selectedEmailId}
              activeFilter={activeFilter}
              setActiveFilter={setActiveFilter}
              onSelectEmail={handleSelectEmail}
              onToggleStar={handleToggleStar}
              threadReplies={selectedThreadReplies}
              aiPrompt={aiPrompt}
              setAiPrompt={handleInboxPromptChange}
              aiGeneratedEmail={aiGeneratedEmail}
              setAiGeneratedEmail={handleGeneratedEmailChange}
              aiActionMessage={aiActionMessage}
              aiActionTone={aiActionTone}
              signature={effectiveSignature}
              mobileShowDetail={mobileShowDetail}
              setMobileShowDetail={setMobileShowDetail}
              activeProvider={activeProvider}
              onProviderSwitch={handleProviderSwitch}
              gmailUnread={gmailUnread}
              outlookUnread={outlookUnread}
              connectedAccounts={connectedAccounts}
              onGenerateRequest={handleInboxGenerate}
              onDirectSendRequest={handleRequestDirectSend}
              onSendGeneratedRequest={handleSendGeneratedFromExpanded}
            />
          )}
          {activePage === 'drafts' && (
            <DraftsPage
              drafts={drafts}
              onDeleteRequest={(id) => setDeletingDraftId(id)}
              onEditRequest={(draft) => {
                setEditingDraft(draft)
                setShowComposeModal(true)
              }}
            />
          )}
          {activePage === 'settings' && (
            <SettingsPage
              signature={signature}
              setSignature={setSignature}
              useSignature={useSignature}
              setUseSignature={setUseSignature}
              connectedAccounts={connectedAccounts}
              connectedEmails={connectedEmails}
              onConnectRequest={(provider) => setConnectModal({ open: true, provider, fromInbox: false })}
              onDisconnect={(provider) => setDisconnectModal({ open: true, provider })}
            />
          )}
          {activePage === 'sent' && (
            <SentPage
              sentEmails={sentEmails}
              selectedSentEmailId={selectedSentEmailId}
              onSelectSentEmail={setSelectedSentEmailId}
              gmailEmails={gmailEmailState}
              outlookEmails={outlookEmailState}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <ConfirmModal
        isOpen={showSignOutModal}
        title="Sign out?"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign out"
        confirmClass="text-white bg-red-600 hover:bg-red-700"
        onCancel={() => setShowSignOutModal(false)}
        onConfirm={() => {
          setShowSignOutModal(false)
          onSignOut()
        }}
      />

      <ConfirmModal
        isOpen={!!deletingDraftId}
        title="Delete draft?"
        message="This action cannot be undone."
        confirmLabel="Delete"
        confirmClass="text-white bg-red-600 hover:bg-red-700"
        onCancel={() => setDeletingDraftId(null)}
        onConfirm={() => handleDeleteDraft(deletingDraftId)}
      />

      <ConfirmModal
        isOpen={disconnectModal.open}
        title="Disconnect account?"
        message={`Are you sure you want to disconnect ${
          disconnectModal.provider === 'gmail' ? 'Gmail' : disconnectModal.provider === 'outlook' ? 'Outlook' : 'this account'
        }?`}
        confirmLabel="Disconnect"
        confirmClass="text-white bg-red-600 hover:bg-red-700"
        onCancel={() => setDisconnectModal({ open: false, provider: null })}
        onConfirm={() => {
          if (disconnectModal.provider) handleDisconnect(disconnectModal.provider)
          setDisconnectModal({ open: false, provider: null })
        }}
      />

      <ConfirmModal
        isOpen={directSendModal.open}
        title="Send directly?"
        message="Are you sure you want to send this email directly without reviewing or viewing it first?"
        confirmLabel="Send Now"
        confirmClass="text-white bg-indigo-600 hover:bg-indigo-700"
        onCancel={() => setDirectSendModal({ open: false, payload: null })}
        onConfirm={() => {
          if (directSendModal.payload) {
            handleSendEmail(directSendModal.payload)
            setAiPrompt('')
            setAiGeneratedEmail('')
            setAiGeneratedMeta(null)
            setAiActionMessage('')
            setAiActionTone('error')
          }
          setDirectSendModal({ open: false, payload: null })
        }}
      />

      <ComposeModal
        isOpen={showComposeModal}
        onClose={() => {
          setShowComposeModal(false)
          setEditingDraft(null)
        }}
        signature={signature}
        useSignature={useSignature}
        initialData={editingDraft}
        onSaveDraft={handleSaveDraft}
        onSendEmail={handleSendEmail}
      />

      <ConnectModal
        isOpen={connectModal.open}
        provider={connectModal.provider}
        onCancel={() => setConnectModal({ open: false, provider: null, fromInbox: false })}
        onConnect={(email) => handleConnect(connectModal.provider, email)}
      />

      <style>{`
        @keyframes fadeScaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}


// --- Inbox Page ---
function InboxPage({
  emails,
  selectedEmail,
  selectedEmailId,
  activeFilter,
  setActiveFilter,
  onSelectEmail,
  onToggleStar,
  threadReplies,
  aiPrompt,
  setAiPrompt,
  aiGeneratedEmail,
  setAiGeneratedEmail,
  aiActionMessage,
  aiActionTone,
  signature,
  mobileShowDetail,
  setMobileShowDetail,
  activeProvider,
  onProviderSwitch,
  gmailUnread,
  outlookUnread,
  connectedAccounts,
  onGenerateRequest,
  onDirectSendRequest,
  onSendGeneratedRequest,
}) {
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const attachmentButtonRef = useRef(null)
  const filters = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'starred', label: 'Starred' },
  ]

  return (
    <div className="flex h-full">
      {/* Email List - narrower */}
      <div
        className={`w-full md:w-80 lg:w-[340px] border-r border-slate-200 bg-white flex flex-col shrink-0 ${
          mobileShowDetail ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* Provider toggle */}
        <div className="px-4 pt-3 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => onProviderSwitch('gmail')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                activeProvider === 'gmail'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <svg className="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
              </svg>
              Gmail
              {gmailUnread > 0 && connectedAccounts.gmail && (
                <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full leading-none">{gmailUnread}</span>
              )}
              {!connectedAccounts.gmail && (
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
              )}
            </button>
            <button
              onClick={() => onProviderSwitch('outlook')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                activeProvider === 'outlook'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <svg className="w-4 h-4 text-blue-600 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 7.387v10.478c0 .23-.08.424-.238.576-.16.154-.352.23-.578.23h-8.26v-6.08L16.91 14l1.957-1.41v-2.534l-1.957 1.38L12.924 8.6V7.157h10.26c.226 0 .418.08.578.233.158.152.238.35.238.576v-.58zM14.078 5.07v14.64L0 17.488V3.293l14.078 1.778zm-2.89 4.252c-.533-.754-1.268-1.13-2.206-1.13-.918 0-1.654.386-2.2 1.16-.55.773-.822 1.772-.822 2.997 0 1.174.264 2.127.793 2.86.53.734 1.248 1.1 2.157 1.1.963 0 1.72-.37 2.27-1.113.55-.743.823-1.733.823-2.97 0-1.28-.272-2.284-.816-3.018v.114zm-1.16 5.057c-.267.477-.648.716-1.143.716-.486 0-.87-.245-1.15-.735-.28-.49-.42-1.14-.42-1.948 0-.84.14-1.506.42-1.998.282-.49.67-.737 1.168-.737.483 0 .863.24 1.142.72.278.48.418 1.142.418 1.985 0 .844-.145 1.52-.435 1.997z" />
              </svg>
              Outlook
              {outlookUnread > 0 && connectedAccounts.outlook && (
                <span className="text-[10px] font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded-full leading-none">{outlookUnread}</span>
              )}
              {!connectedAccounts.outlook && (
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
              )}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 px-4 py-3 border-b border-slate-100">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeFilter === f.id
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Email List */}
        <div className="flex-1 overflow-y-auto">
          {emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12">
              <InboxIcon className="w-10 h-10 mb-3" />
              <p className="text-sm font-medium">No emails found</p>
            </div>
          ) : (
            emails.map((email) => (
              <button
                key={email.id}
                onClick={() => onSelectEmail(email.id)}
                className={`w-full text-left px-4 py-3.5 border-b border-slate-50 flex items-start gap-3 transition-colors cursor-pointer ${
                  email.id === selectedEmailId
                    ? 'bg-indigo-50/70'
                    : 'hover:bg-slate-50'
                }`}
              >
                <div className={`w-9 h-9 rounded-full ${email.avatarColor} flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5`}>
                  {email.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {!email.read && (
                      <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" />
                    )}
                    <span className={`text-sm truncate ${email.read ? 'font-medium text-slate-700' : 'font-bold text-slate-900'}`}>
                      {email.sender}
                    </span>
                    <span className="text-xs text-slate-400 ml-auto shrink-0">{email.time}</span>
                  </div>
                  <p className={`text-sm truncate mb-0.5 ${email.read ? 'text-slate-500' : 'font-semibold text-slate-800'}`}>
                    {email.subject}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{email.preview}</p>
                </div>
                <button
                  onClick={(e) => onToggleStar(email.id, e)}
                  className={`shrink-0 mt-1 cursor-pointer transition-colors ${
                    email.starred ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'
                  }`}
                  aria-label={email.starred ? 'Unstar' : 'Star'}
                >
                  <StarIcon className="w-4 h-4" filled={email.starred} />
                </button>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Email Detail - wider */}
      <div
        className={`flex-1 flex flex-col bg-white min-w-0 ${
          mobileShowDetail ? 'flex' : 'hidden md:flex'
        }`}
      >
        {selectedEmail ? (
          <>
            {/* Detail Header */}
            <div className="px-6 py-5 border-b border-slate-100 shrink-0">
              <div className="flex items-start gap-4">
                <button
                  onClick={() => setMobileShowDetail(false)}
                  className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer shrink-0 mt-0.5"
                  aria-label="Back to list"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                </button>
                <div className={`w-11 h-11 rounded-full ${selectedEmail.avatarColor} flex items-center justify-center text-sm font-bold text-white shrink-0`}>
                  {selectedEmail.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-slate-900 truncate">{selectedEmail.sender}</h2>
                  <p className="text-sm font-medium text-slate-600 truncate">{selectedEmail.subject}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {selectedEmail.email} &middot; {selectedEmail.date}
                  </p>
                </div>
                <button
                  onClick={() => onToggleStar(selectedEmail.id)}
                  className={`shrink-0 cursor-pointer transition-colors ${
                    selectedEmail.starred ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'
                  }`}
                  aria-label={selectedEmail.starred ? 'Unstar' : 'Star'}
                >
                  <StarIcon className="w-5 h-5" filled={selectedEmail.starred} />
                </button>
              </div>
            </div>

            {/* Scrollable email body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                {selectedEmail.body}
              </pre>
              {threadReplies.length > 0 && (
                <div className="mt-6 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Thread Replies</p>
                  {threadReplies.map((reply) => (
                    <div
                      key={reply.id}
                      className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-indigo-700">{reply.from}</p>
                        <p className="text-xs text-slate-400">{reply.date} · {reply.time}</p>
                      </div>
                      <p className="text-xs text-slate-500 mb-2">To: {reply.to}</p>
                      <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                        {reply.body}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI Assistant - sticky at bottom */}
            <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/70 shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <SparklesIcon className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-semibold text-slate-600">AI Assistant</span>
              </div>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={2}
                placeholder={aiGeneratedEmail ? 'Send a new prompt to regenerate this email...' : 'Tell the AI how to reply...'}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
              />
              {aiGeneratedEmail && (
                <div className="mt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-slate-600">Generated Email (Editable)</span>
                  </div>
                  <textarea
                    value={aiGeneratedEmail}
                    onChange={(e) => setAiGeneratedEmail(e.target.value)}
                    rows={12}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={onSendGeneratedRequest}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
                    >
                      <SendIcon className="w-4 h-4" />
                      Send
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between mt-2">
                <button
                  ref={attachmentButtonRef}
                  onClick={() => setAttachmentMenuOpen((prev) => !prev)}
                  className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  aria-label="Attach file"
                >
                  <PaperclipIcon className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onGenerateRequest}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors cursor-pointer"
                  >
                    <SparklesIcon className="w-3.5 h-3.5" />
                    Generate
                  </button>
                  <button
                    onClick={onDirectSendRequest}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-200 rounded-lg hover:bg-slate-300 transition-colors cursor-pointer"
                  >
                    <SendIcon className="w-3.5 h-3.5" />
                    {'Generate & Send'}
                  </button>
                </div>
              </div>
              {aiActionMessage && (
                <p className={`mt-2 text-xs font-medium ${aiActionTone === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {aiActionMessage}
                </p>
              )}
              <AttachmentMenu
                isOpen={attachmentMenuOpen}
                anchorRef={attachmentButtonRef}
                onClose={() => setAttachmentMenuOpen(false)}
                onSelect={() => setAttachmentMenuOpen(false)}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <InboxIcon className="w-12 h-12 mx-auto mb-3" />
              <p className="text-sm font-medium">Select an email to read</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


// --- Drafts Page ---
function DraftsPage({ drafts, onDeleteRequest, onEditRequest }) {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <DraftIcon className="w-6 h-6 text-slate-400" />
          <h2 className="text-xl font-bold text-slate-900">Drafts</h2>
          <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            {drafts.length}
          </span>
        </div>

        {drafts.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <DraftIcon className="w-10 h-10 mx-auto mb-3" />
            <p className="text-sm font-medium">No drafts yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium text-slate-500">To:</span>
                    <span className="text-sm font-medium text-slate-700 truncate">{draft.to}</span>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0 ml-3">{draft.time}</span>
                </div>
                <p className="text-sm font-semibold text-slate-900 mb-1">{draft.subject}</p>
                <p className="text-xs text-slate-500 line-clamp-2">{draft.body}</p>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => onEditRequest(draft)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    <PencilIcon className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => onDeleteRequest(draft.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors cursor-pointer"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SentPage({ sentEmails, selectedSentEmailId, onSelectSentEmail, gmailEmails, outlookEmails }) {
  const selectedSentEmail = sentEmails.find((email) => email.id === selectedSentEmailId) || sentEmails[0]
  const allProviderEmails = [...gmailEmails, ...outlookEmails]
  const relatedEmailId = selectedSentEmail ? (selectedSentEmail.replyToId || selectedSentEmail.threadRootId) : null
  const repliedToEmail = relatedEmailId
    ? allProviderEmails.find((email) => String(email.id) === String(relatedEmailId))
    : null

  return (
    <div className="h-full bg-white flex">
      <div className="w-full md:w-80 lg:w-[340px] border-r border-slate-200 flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <SentIcon className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg font-bold text-slate-900">Sent</h2>
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {sentEmails.length}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sentEmails.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <SentIcon className="w-10 h-10 mx-auto mb-3" />
              <p className="text-sm font-medium">No sent emails yet</p>
            </div>
          ) : (
            sentEmails.map((email) => (
              <button
                key={email.id}
                onClick={() => onSelectSentEmail(email.id)}
                className={`w-full text-left px-3.5 py-2.5 border-b border-slate-100 transition-colors cursor-pointer ${
                  selectedSentEmail && selectedSentEmail.id === email.id
                    ? 'bg-indigo-50/70'
                    : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-slate-900 truncate">To: {email.to}</p>
                  <span className="text-xs text-slate-400 shrink-0 ml-3">{email.time}</span>
                </div>
                <p className="text-sm font-medium text-slate-700 truncate">{email.subject}</p>
                <p className="text-xs text-slate-500 truncate">{email.body}</p>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto">
        {selectedSentEmail ? (
          <div className="max-w-4xl mx-auto px-6 py-8 space-y-4">
            <div className="rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Sent Email</p>
              <p className="text-xs text-slate-500 mb-1">To: {selectedSentEmail.to}</p>
              <p className="text-sm font-semibold text-slate-900 mb-2">{selectedSentEmail.subject}</p>
              <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                {selectedSentEmail.body}
              </pre>
            </div>

            {repliedToEmail && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Replied To</p>
                <p className="text-xs text-slate-500 mb-1">
                  From: {repliedToEmail.sender} ({repliedToEmail.email})
                </p>
                <p className="text-sm font-semibold text-slate-900 mb-2">{repliedToEmail.subject}</p>
                <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                  {repliedToEmail.body}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400">
            <div className="text-center">
              <SentIcon className="w-10 h-10 mx-auto mb-3" />
              <p className="text-sm font-medium">Select a sent email to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


// --- Settings Page ---
function SettingsPage({ signature, setSignature, useSignature, setUseSignature, connectedAccounts, connectedEmails, onConnectRequest, onDisconnect }) {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <SettingsIcon className="w-6 h-6 text-slate-400" />
          <h2 className="text-xl font-bold text-slate-900">Settings</h2>
        </div>

        {/* Email Signature */}
        <div className="mb-10">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Email Signature</h3>
          <p className="text-xs text-slate-500 mb-3">This signature will be appended to your generated emails.</p>

          {/* Use signature toggle */}
          <label className="flex items-center gap-3 mb-3 cursor-pointer select-none">
            <div
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                useSignature ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'
              }`}
              onClick={() => setUseSignature(!useSignature)}
              role="checkbox"
              aria-checked={useSignature}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setUseSignature(!useSignature) } }}
            >
              {useSignature && <CheckIcon className="w-3.5 h-3.5 text-white" />}
            </div>
            <span className="text-sm font-medium text-slate-700" onClick={() => setUseSignature(!useSignature)}>
              Use signature
            </span>
          </label>

          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={4}
            placeholder={'e.g. Best regards,\nJohn Doe\nProduct Manager at Acme Corp'}
            disabled={!useSignature}
            className={`w-full px-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition-opacity ${
              !useSignature ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          />
        </div>

        {/* Connected Accounts */}
        <div>
          <h3 className="text-sm font-bold text-slate-900 mb-1">Connected Accounts</h3>
          <p className="text-xs text-slate-500 mb-4">Manage your connected email accounts.</p>

          <div className="space-y-3">
            {/* Gmail */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Gmail</p>
                  <p className="text-xs text-slate-500">
                    {connectedAccounts.gmail && connectedEmails.gmail
                      ? connectedEmails.gmail
                      : 'Google account'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {connectedAccounts.gmail && (
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                    Connected
                  </span>
                )}
                <button
                  onClick={() => connectedAccounts.gmail ? onDisconnect('gmail') : onConnectRequest('gmail')}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
                    connectedAccounts.gmail
                      ? 'text-red-600 bg-red-50 hover:bg-red-100'
                      : 'text-white bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {connectedAccounts.gmail ? 'Disconnect' : 'Connect'}
                </button>
              </div>
            </div>

            {/* Outlook */}
            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 7.387v10.478c0 .23-.08.424-.238.576-.16.154-.352.23-.578.23h-8.26v-6.08L16.91 14l1.957-1.41v-2.534l-1.957 1.38L12.924 8.6V7.157h10.26c.226 0 .418.08.578.233.158.152.238.35.238.576v-.58zM14.078 5.07v14.64L0 17.488V3.293l14.078 1.778zm-2.89 4.252c-.533-.754-1.268-1.13-2.206-1.13-.918 0-1.654.386-2.2 1.16-.55.773-.822 1.772-.822 2.997 0 1.174.264 2.127.793 2.86.53.734 1.248 1.1 2.157 1.1.963 0 1.72-.37 2.27-1.113.55-.743.823-1.733.823-2.97 0-1.28-.272-2.284-.816-3.018v.114zm-1.16 5.057c-.267.477-.648.716-1.143.716-.486 0-.87-.245-1.15-.735-.28-.49-.42-1.14-.42-1.948 0-.84.14-1.506.42-1.998.282-.49.67-.737 1.168-.737.483 0 .863.24 1.142.72.278.48.418 1.142.418 1.985 0 .844-.145 1.52-.435 1.997z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Outlook</p>
                  <p className="text-xs text-slate-500">
                    {connectedAccounts.outlook && connectedEmails.outlook
                      ? connectedEmails.outlook
                      : 'Microsoft account'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {connectedAccounts.outlook && (
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                    Connected
                  </span>
                )}
                <button
                  onClick={() => connectedAccounts.outlook ? onDisconnect('outlook') : onConnectRequest('outlook')}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
                    connectedAccounts.outlook
                      ? 'text-red-600 bg-red-50 hover:bg-red-100'
                      : 'text-white bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {connectedAccounts.outlook ? 'Disconnect' : 'Connect'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
