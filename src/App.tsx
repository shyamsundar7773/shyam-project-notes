import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { NotesWorkspace } from './components/NotesWorkspace'
import {
  passwordRecoveryLinkError,
  passwordRecoveryRedirect,
  recoveryModeAfterAuthEvent,
  updatePasswordFromRecovery,
  validateEmailInput,
  validatePasswordInput,
} from './lib/auth'
import {
  createFile,
  deleteFile,
  deleteTaxonomyRecord,
  getAuthErrorMessage,
  isValidTaxonomyPath,
  loadWorkspaceData,
  renameFile,
  validateFileName,
  type Category,
  type NoteFile,
  type Subtopic,
  type TaxonomyTable,
  type Topic,
  type WorkspaceData,
} from './lib/phase1'
import { getSupabaseClient, supabaseConfiguration } from './lib/supabase'
import './App.css'

type Route = {
  path: string
  search: string
}

function useRoute() {
  const [route, setRoute] = useState<Route>(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }))

  useEffect(() => {
    const syncRoute = () =>
      setRoute({
        path: window.location.pathname,
        search: window.location.search,
      })
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  const navigate = useCallback((url: string) => {
    window.history.pushState({}, '', url)
    setRoute({
      path: window.location.pathname,
      search: window.location.search,
    })
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  }, [])

  return { route, navigate }
}

function useSession(client: SupabaseClient | null) {
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const [loading, setLoading] = useState(() => Boolean(client))
  const [error, setError] = useState('')
  const [recoveryMode, setRecoveryMode] = useState(false)

  const updateSession = useCallback((nextSession: Session | null) => {
    sessionRef.current = nextSession
    setSession(nextSession)
    setRecoveryMode(false)
    setError('')
  }, [])

  useEffect(() => {
    if (!client) {
      return
    }

    let active = true
    let receivedAuthEvent = false
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      receivedAuthEvent = true
      if (active) {
        const wasSignedIn = sessionRef.current !== null
        sessionRef.current = nextSession
        setSession(nextSession)
        setRecoveryMode((current) =>
          recoveryModeAfterAuthEvent(current, _event, nextSession !== null),
        )
        setLoading(false)
        setError(
          _event === 'SIGNED_OUT' && wasSignedIn
            ? 'Your session ended. Sign in again to continue.'
            : '',
        )
      }
    })

    void client.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active || receivedAuthEvent) {
          return
        }
        sessionRef.current = data.session
        setSession(data.session)
        setLoading(false)
        if (sessionError) {
          setError('Your session could not be restored. Please sign in again.')
        }
      })
      .catch(() => {
        if (active && !receivedAuthEvent) {
          sessionRef.current = null
          setSession(null)
          setLoading(false)
          setError('Your session could not be restored. Please sign in again.')
        }
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [client])

  return {
    session,
    updateSession,
    loading,
    error,
    setError,
    recoveryMode,
    setRecoveryMode,
  }
}

function BrandHeader({
  email,
  onSignOut,
  signingOut,
}: {
  email?: string
  onSignOut?: () => void
  signingOut?: boolean
}) {
  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="Shyam Project Notes home">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 3.75h7l4.25 4.3v12.2H7a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z" />
            <path d="M14 3.9v4.4h4.1M8.5 12h7M8.5 15.5h7" />
          </svg>
        </span>
        <span className="brand-name">
          Shyam <span>Project Notes</span>
        </span>
      </a>
      {email ? (
        <div className="account-actions">
          <span className="account-email">{email}</span>
          <button
            className="button button--quiet button--small"
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : (
        <span className="header-label">PERSONAL WORKSPACE</span>
      )}
    </header>
  )
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>Shyam Project Notes</span>
      <span>Made for learning, one note at a time.</span>
    </footer>
  )
}

function AuthPanel({
  client,
  restoredSessionError,
  onAuthenticated,
}: {
  client: SupabaseClient
  restoredSessionError: string
  onAuthenticated: (session: Session | null) => void
}) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up' | 'reset-request'>(
    'sign-in',
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(restoredSessionError)
  const [error, setError] = useState('')
  const submissionLock = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionLock.current) {
      return
    }
    const emailError = validateEmailInput(email)
    const passwordError =
      mode === 'reset-request' ? null : validatePasswordInput(password)
    if (emailError || passwordError) {
      setError(emailError ?? passwordError ?? '')
      setMessage('')
      return
    }
    submissionLock.current = true
    setBusy(true)
    setError('')
    setMessage('')

    try {
      if (mode === 'reset-request') {
        const { error: resetError } =
          await client.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: passwordRecoveryRedirect(window.location.origin),
          })
        if (resetError) {
          setError(getAuthErrorMessage(resetError))
        } else {
          setMessage(
            'If an account can receive password recovery for this address, instructions will be sent to its email.',
          )
        }
      } else if (mode === 'sign-up') {
        const { data, error: authError } = await client.auth.signUp({
          email: email.trim(),
          password,
        })
        if (authError) {
          setError(getAuthErrorMessage(authError))
        } else if (data.session) {
          onAuthenticated(data.session)
        } else {
          setMessage(
            'Account request received. If email confirmation is enabled, check your inbox and confirm your address before signing in.',
          )
          setMode('sign-in')
        }
      } else {
        const { data, error: authError } =
          await client.auth.signInWithPassword({
            email: email.trim(),
            password,
          })
        if (authError) {
          setError(getAuthErrorMessage(authError))
        } else if (data.session) {
          onAuthenticated(data.session)
        } else {
          setError('Sign-in did not return a session. Try again.')
        }
      }
    } catch (authError) {
      setError(getAuthErrorMessage(authError))
    } finally {
      submissionLock.current = false
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="eyebrow">YOUR PRIVATE LEARNING SPACE</p>
        <h1 id="auth-title">
          {mode === 'sign-in'
            ? 'Welcome back'
            : mode === 'sign-up'
              ? 'Create your account'
              : 'Reset your password'}
        </h1>
        <p className="auth-intro">
          {mode === 'reset-request'
            ? 'Enter your account email and we will send password recovery instructions if the address can receive them.'
            : 'Sign in to organize your files and learning topics.'}
        </p>
        {error || message ? (
          <div
            className={error ? 'notice notice--error' : 'notice notice--info'}
            role={error ? 'alert' : 'status'}
          >
            {error || message}
          </div>
        ) : null}
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              autoComplete="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
            />
          </label>
          {mode !== 'reset-request' ? (
            <label className="field">
              <span>Password</span>
              <input
                autoComplete={
                  mode === 'sign-in' ? 'current-password' : 'new-password'
                }
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={mode === 'sign-up' ? 6 : undefined}
                maxLength={256}
              />
            </label>
          ) : null}
          <button className="button button--primary" type="submit" disabled={busy}>
            {busy
              ? mode === 'sign-in'
                ? 'Signing in…'
                : mode === 'sign-up'
                  ? 'Creating account…'
                  : 'Sending instructions…'
              : mode === 'sign-in'
                ? 'Sign in'
                : mode === 'sign-up'
                  ? 'Create account'
                  : 'Send recovery email'}
          </button>
        </form>
        <p className="auth-switch">
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setMode(
                mode === 'sign-in'
                  ? 'sign-up'
                  : mode === 'sign-up'
                    ? 'sign-in'
                    : 'sign-in',
              )
              setError('')
              setMessage('')
            }}
            disabled={busy}
          >
            {mode === 'sign-up' || mode === 'reset-request'
              ? 'Back to sign in'
              : 'Create an account'}
          </button>
          {mode === 'sign-in' ? (
            <>
              <span aria-hidden="true"> · </span>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setMode('reset-request')
                  setError('')
                  setMessage('')
                }}
                disabled={busy}
              >
                Forgot password?
              </button>
            </>
          ) : null}
        </p>
      </section>
    </main>
  )
}

function RecoveryPasswordPanel({
  client,
  hasRecoverySession,
  onComplete,
}: {
  client: SupabaseClient
  hasRecoverySession: boolean
  onComplete: () => Promise<boolean>
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  const [completing, setCompleting] = useState(false)
  const submissionLock = useRef(false)

  async function returnToSignIn() {
    if (completing) return
    setCompleting(true)
    setError('')
    try {
      if (!(await onComplete())) {
        setError(
          'Your password was updated, but this recovery session could not be cleared. Sign out before signing in again.',
        )
      }
    } catch {
      setError(
        'Your password was updated, but sign-out could not be completed. Close this browser session before signing in again.',
      )
    } finally {
      setCompleting(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionLock.current || complete) return
    submissionLock.current = true
    setBusy(true)
    setError('')
    try {
      const updateError = await updatePasswordFromRecovery(
        client,
        hasRecoverySession,
        password,
        confirmation,
      )
      if (updateError) {
        setError(updateError)
      } else {
        setComplete(true)
      }
    } catch (updateError) {
      setError(getAuthErrorMessage(updateError))
    } finally {
      submissionLock.current = false
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="recovery-title">
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1 id="recovery-title">
          {complete ? 'Password updated' : 'Choose a new password'}
        </h1>
        {complete ? (
          <>
            <p className="auth-intro">
              Your password has been updated. Return to sign in with your new
              password.
            </p>
            {error ? (
              <div className="notice notice--error" role="alert">
                {error}
              </div>
            ) : null}
            <button
              className="button button--primary"
              type="button"
              onClick={() => void returnToSignIn()}
              disabled={completing}
            >
              {completing ? 'Signing out…' : 'Return to sign in'}
            </button>
          </>
        ) : (
          <>
            <p className="auth-intro">
              Choose at least 8 characters and enter the same password twice.
            </p>
            {error ? (
              <div className="notice notice--error" role="alert">
                {error}
              </div>
            ) : null}
            <form className="auth-form" onSubmit={submit}>
              <label className="field">
                <span>New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  maxLength={256}
                  required
                />
              </label>
              <label className="field">
                <span>Confirm new password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  minLength={8}
                  maxLength={256}
                  required
                />
              </label>
              <button
                className="button button--primary"
                type="submit"
                disabled={busy}
              >
                {busy ? 'Updating password…' : 'Update password'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  )
}

function useWorkspace(client: SupabaseClient) {
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshIndex, setRefreshIndex] = useState(0)

  const refresh = useCallback(() => {
    setLoading(true)
    setError('')
    setData(null)
    setRefreshIndex((index) => index + 1)
  }, [])

  useEffect(() => {
    let active = true
    void loadWorkspaceData(client)
      .then((nextData) => {
        if (active) {
          setData(nextData)
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Your workspace could not be loaded. Try again.',
          )
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [client, refreshIndex])

  return { data, loading, error, refresh }
}

type TaxonomyDelete = {
  table: TaxonomyTable
  id: string
  name: string
  title: string
  description: string
}

type FileAction =
  | { kind: 'taxonomy'; value: TaxonomyDelete }
  | { kind: 'rename'; value: NoteFile }
  | { kind: 'delete-file'; value: NoteFile }

function ActionDialog({
  action,
  busy,
  error,
  renameValue,
  onRenameChange,
  onClose,
  onConfirm,
}: {
  action: FileAction | null
  busy: boolean
  error: string
  renameValue: string
  onRenameChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = 'action-dialog-title'
  const descriptionId = 'action-dialog-description'

  useEffect(() => {
    const dialog = dialogRef.current
    if (action && dialog && !dialog.open) {
      dialog.showModal()
    } else if (!action && dialog?.open) {
      dialog.close()
    }
  }, [action])

  if (!action) {
    return <dialog ref={dialogRef} />
  }

  const isRename = action.kind === 'rename'
  const title =
    action.kind === 'taxonomy'
      ? action.value.title
      : action.kind === 'rename'
        ? 'Rename file'
        : 'Delete file'
  const description =
    action.kind === 'taxonomy'
      ? action.value.description
      : action.kind === 'rename'
        ? 'Choose a new name for this file. Its taxonomy path will not change.'
        : 'Delete this file container? This cannot be undone. Notes must not be added to or removed with a file automatically.'

  return (
    <dialog
      ref={dialogRef}
      className="action-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) {
          event.preventDefault()
        }
      }}
    >
      <div className="dialog-content">
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        {action.kind === 'taxonomy' ? (
          <p className="dialog-record">
            Selected: <strong>{action.value.name}</strong>
          </p>
        ) : null}
        {isRename ? (
          <label className="field">
            <span>File Name</span>
            <input
              autoFocus
              value={renameValue}
              maxLength={120}
              onChange={(event) => onRenameChange(event.target.value)}
            />
          </label>
        ) : null}
        {error ? (
          <div className="notice notice--error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="dialog-actions">
          <button
            className="button button--quiet"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className={
              isRename ? 'button button--primary' : 'button button--danger'
            }
            type="button"
            onClick={onConfirm}
            disabled={busy || (isRename && Boolean(validateFileName(renameValue)))}
          >
            {busy
              ? 'Working…'
              : isRename
                ? 'Save name'
                : action.kind === 'taxonomy'
                  ? 'Delete selection'
                  : 'Delete file'}
          </button>
        </div>
      </div>
    </dialog>
  )
}

function TaxonomySelectors({
  categories,
  topics,
  subtopics,
  categoryId,
  topicId,
  subtopicId,
  loading,
  onCategoryChange,
  onTopicChange,
  onSubtopicChange,
  onDelete,
  prefix,
}: {
  categories: Category[]
  topics: Topic[]
  subtopics: Subtopic[]
  categoryId: string
  topicId: string
  subtopicId: string
  loading: boolean
  onCategoryChange: (value: string) => void
  onTopicChange: (value: string) => void
  onSubtopicChange: (value: string) => void
  onDelete?: (record: TaxonomyDelete) => void
  prefix: string
}) {
  const availableTopics = topics.filter(
    (topic) => topic.category_id === categoryId,
  )
  const availableSubtopics = subtopics.filter(
    (subtopic) => subtopic.topic_id === topicId,
  )
  const selectedCategory = categories.find(
    (category) => category.id === categoryId,
  )
  const selectedTopic = availableTopics.find((topic) => topic.id === topicId)
  const selectedSubtopic = availableSubtopics.find(
    (subtopic) => subtopic.id === subtopicId,
  )

  const selected: Array<{
    table: TaxonomyTable
    name: string
    record?: Category | Topic | Subtopic
  }> = [
    { table: 'categories', name: 'Category', record: selectedCategory },
    { table: 'topics', name: 'Topic', record: selectedTopic },
    { table: 'subtopics', name: 'Subtopic', record: selectedSubtopic },
  ]

  function requestDelete(index: number) {
    const entry = selected[index]
    if (!entry.record || !onDelete) {
      return
    }
    const details = [
      'categories: This removes the selected Category and cascades to its Topics and Subtopics only if no descendant Subtopic contains a File. Files and their notes are never cascade-deleted.',
      'topics: This removes the selected Topic and cascades to its Subtopics only if no descendant Subtopic contains a File. Files and their notes are never cascade-deleted.',
      'subtopics: This removes only the selected Subtopic, and only when it has no File. Files and their notes are never cascade-deleted.',
    ][index]
    onDelete({
      table: entry.table,
      id: entry.record.id,
      name: entry.record.name,
      title: `Delete ${entry.name.toLowerCase()}?`,
      description: details,
    })
  }

  return (
    <div className="taxonomy-grid">
      <div className="taxonomy-field">
        <label htmlFor={`${prefix}-category`}>Category</label>
        <div className="selector-action-row">
          <select
            id={`${prefix}-category`}
            value={categoryId}
            disabled={loading}
            onChange={(event) => onCategoryChange(event.target.value)}
          >
            <option value="">
              {loading ? 'Loading categories…' : 'Select a category'}
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          {onDelete ? (
            <button
              className="icon-button"
              type="button"
              aria-label="Delete selected Category"
              title="Delete selected Category"
              disabled={!selectedCategory || loading}
              onClick={() => requestDelete(0)}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
        {!loading && categoryId && availableTopics.length === 0 ? (
          <p className="selector-empty">No topics in this category yet.</p>
        ) : null}
      </div>

      <div className="taxonomy-field">
        <label htmlFor={`${prefix}-topic`}>Topic</label>
        <div className="selector-action-row">
          <select
            id={`${prefix}-topic`}
            value={topicId}
            disabled={!categoryId || loading}
            onChange={(event) => onTopicChange(event.target.value)}
          >
            <option value="">
              {!categoryId ? 'Select a category first' : 'Select a topic'}
            </option>
            {availableTopics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </select>
          {onDelete ? (
            <button
              className="icon-button"
              type="button"
              aria-label="Delete selected Topic"
              title="Delete selected Topic"
              disabled={!selectedTopic || loading}
              onClick={() => requestDelete(1)}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
        {!loading && topicId && availableSubtopics.length === 0 ? (
          <p className="selector-empty">No subtopics in this topic yet.</p>
        ) : null}
      </div>

      <div className="taxonomy-field">
        <label htmlFor={`${prefix}-subtopic`}>Subtopic</label>
        <div className="selector-action-row">
          <select
            id={`${prefix}-subtopic`}
            value={subtopicId}
            disabled={!topicId || loading}
            onChange={(event) => onSubtopicChange(event.target.value)}
          >
            <option value="">
              {!topicId ? 'Select a topic first' : 'Select a subtopic'}
            </option>
            {availableSubtopics.map((subtopic) => (
              <option key={subtopic.id} value={subtopic.id}>
                {subtopic.name}
              </option>
            ))}
          </select>
          {onDelete ? (
            <button
              className="icon-button"
              type="button"
              aria-label="Delete selected Subtopic"
              title="Delete selected Subtopic"
              disabled={!selectedSubtopic || loading}
              onClick={() => requestDelete(2)}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function HomePage({
  client,
  navigate,
}: {
  client: SupabaseClient
  navigate: (url: string) => void
}) {
  const { data, loading, error, refresh } = useWorkspace(client)
  const [categoryId, setCategoryId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [subtopicId, setSubtopicId] = useState('')
  const [activeFileId, setActiveFileId] = useState('')
  const [action, setAction] = useState<FileAction | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const actionLock = useRef(false)

  const categories = data?.categories ?? []
  const topics = data?.topics ?? []
  const subtopics = data?.subtopics ?? []
  const files = data?.files ?? []
  const activeFile = files.find((file) => file.id === activeFileId)
  const validPath = useMemo(
    () =>
      Boolean(
        data &&
          isValidTaxonomyPath(
            {
              category_id: categoryId,
              topic_id: topicId,
              subtopic_id: subtopicId,
            },
            data,
          ),
      ),
    [categoryId, data, subtopicId, topicId],
  )

  async function confirmAction() {
    if (!action || actionLock.current) {
      return
    }
    actionLock.current = true
    setActionBusy(true)
    setActionError('')
    try {
      if (action.kind === 'taxonomy') {
        await deleteTaxonomyRecord(
          client,
          action.value.table,
          action.value.id,
        )
        setCategoryId('')
        setTopicId('')
        setSubtopicId('')
        setFeedback('Taxonomy record deleted.')
      } else if (action.kind === 'rename') {
        await renameFile(client, action.value.id, renameValue)
        setFeedback('File renamed.')
      } else {
        await deleteFile(client, action.value.id)
        if (activeFileId === action.value.id) {
          setActiveFileId('')
        }
        setFeedback('File deleted.')
      }
      setAction(null)
      refresh()
    } catch (actionFailure) {
      setActionError(
        actionFailure instanceof Error
          ? actionFailure.message
          : 'The operation failed. Try again.',
      )
    } finally {
      actionLock.current = false
      setActionBusy(false)
    }
  }

  function startRename(file: NoteFile) {
    setRenameValue(file.name)
    setActionError('')
    setAction({ kind: 'rename', value: file })
  }

  function openNotes() {
    if (!data || !validPath) {
      return
    }
    const query = new URLSearchParams({
      categoryId,
      topicId,
      subtopicId,
    })
    navigate(`/notes?${query.toString()}`)
  }

  return (
    <>
      <main className="main-content">
        <section className="page-heading page-heading--compact">
          <p className="eyebrow">A PLACE FOR WHAT YOU LEARN</p>
          <h1>Home</h1>
          <p className="page-description">
            Organize learning into a clear path, then open a workspace when
            you’re ready to study.
          </p>
        </section>

        {error ? (
          <div className="notice notice--error" role="alert">
            {error}{' '}
            <button className="text-button" type="button" onClick={refresh}>
              Try again
            </button>
          </div>
        ) : null}
        {feedback ? (
          <div className="notice notice--success" role="status">
            {feedback}
          </div>
        ) : null}

        <section className="panel" aria-labelledby="files-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">YOUR COLLECTION</p>
              <h2 id="files-heading">Files</h2>
            </div>
          </div>
          {loading ? (
            <p className="state-message" role="status">
              Loading your files…
            </p>
          ) : files.length === 0 ? (
            <p className="state-message">
              No files yet. Choose a Category → Topic → Subtopic and open Notes to add a note.
            </p>
          ) : (
            <ul className="file-list">
              {files.map((file) => (
                <li key={file.id}>
                  <div
                    className={`file-card-row${activeFileId === file.id ? ' file-card-row--active' : ''}`}
                  >
                    <button
                      className="file-card"
                      type="button"
                      aria-pressed={activeFileId === file.id}
                      onClick={() => setActiveFileId(file.id)}
                    >
                      <span className="file-card-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M5 4.75A1.75 1.75 0 0 1 6.75 3h6.9L19 8.35v10.9A1.75 1.75 0 0 1 17.25 21h-10.5A1.75 1.75 0 0 1 5 19.25Z" />
                          <path d="M13.5 3.5v5h5M8 13h8M8 16.5h6" />
                        </svg>
                      </span>
                      <span className="file-card-copy">
                        <strong>{file.name}</strong>
                        <span>
                          {categories.find(
                            (category) => category.id === file.category_id,
                          )?.name ?? 'Category'}{' '}
                          <span aria-hidden="true">/</span>{' '}
                          {topics.find((topic) => topic.id === file.topic_id)
                            ?.name ?? 'Topic'}{' '}
                          <span aria-hidden="true">/</span>{' '}
                          {subtopics.find(
                            (subtopic) => subtopic.id === file.subtopic_id,
                          )?.name ?? 'Subtopic'}
                        </span>
                      </span>
                    </button>
                    <span
                      className="file-menu"
                    >
                      <details
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.currentTarget.open = false
                            event.currentTarget
                              .querySelector('summary')
                              ?.focus()
                          }
                        }}
                      >
                        <summary aria-label={`Actions for ${file.name}`}>
                          <span aria-hidden="true">•••</span>
                        </summary>
                        <div className="file-menu-options">
                          <button
                            type="button"
                            onClick={() => startRename(file)}
                          >
                            Rename
                          </button>
                          <button
                            className="menu-danger"
                            type="button"
                            onClick={() => {
                              setActionError('')
                              setAction({ kind: 'delete-file', value: file })
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </details>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {activeFile ? (
            <div className="active-file" role="status">
              <span className="active-file-dot" aria-hidden="true" />
              <span>
                Active file: <strong>{activeFile.name}</strong>
              </span>
            </div>
          ) : null}
        </section>

        <section className="panel taxonomy-panel" aria-labelledby="path-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CHOOSE A STUDY PATH</p>
              <h2 id="path-heading">Open your notes</h2>
            </div>
          </div>
          {data && categories.length === 0 && !loading ? (
            <p className="state-message">
              No categories are available yet. Add taxonomy records through the
              approved data setup before choosing a notes path.
            </p>
          ) : null}
          <TaxonomySelectors
            prefix="home"
            categories={categories}
            topics={topics}
            subtopics={subtopics}
            categoryId={categoryId}
            topicId={topicId}
            subtopicId={subtopicId}
            loading={loading || !data}
            onCategoryChange={(value) => {
              setCategoryId(value)
              setTopicId('')
              setSubtopicId('')
            }}
            onTopicChange={(value) => {
              setTopicId(value)
              setSubtopicId('')
            }}
            onSubtopicChange={setSubtopicId}
            onDelete={(value) => {
              setActionError('')
              setAction({ kind: 'taxonomy', value })
            }}
          />
          <div className="panel-footer">
            <p className="field-hint">
              Select a complete Category → Topic → Subtopic path.
            </p>
            <button
              className="button button--primary"
              type="button"
              disabled={!validPath || loading}
              onClick={openNotes}
            >
              Open Notes
            </button>
          </div>
        </section>
      </main>
      <ActionDialog
        action={action}
        busy={actionBusy}
        error={actionError}
        renameValue={renameValue}
        onRenameChange={setRenameValue}
        onClose={() => {
          if (!actionBusy) {
            setAction(null)
            setActionError('')
          }
        }}
        onConfirm={() => void confirmAction()}
      />
    </>
  )
}

function CreateFilePage({
  client,
  onCancel,
  onCreated,
}: {
  client: SupabaseClient
  onCancel: () => void
  onCreated: () => void
}) {
  const { data, loading, error: loadError, refresh } = useWorkspace(client)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [subtopicId, setSubtopicId] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState(false)
  const successTimer = useRef<number | null>(null)
  const submissionLock = useRef(false)

  useEffect(
    () => () => {
      if (successTimer.current !== null) {
        window.clearTimeout(successTimer.current)
      }
    },
    [],
  )

  const pathValid = Boolean(
    data &&
      isValidTaxonomyPath(
        {
          category_id: categoryId,
          topic_id: topicId,
          subtopic_id: subtopicId,
        },
        data,
      ),
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionLock.current) {
      return
    }
    setValidationMessage('')
    setSubmitError('')

    const nameError = validateFileName(name)
    if (nameError) {
      setValidationMessage(nameError)
      return
    }
    if (!data || !pathValid) {
      setValidationMessage(
        'Choose a valid Category, Topic, and Subtopic path before creating the file.',
      )
      return
    }

    submissionLock.current = true
    setSubmitting(true)
    try {
      await createFile(client, name, {
        category_id: categoryId,
        topic_id: topicId,
        subtopic_id: subtopicId,
      })
      setCreated(true)
      successTimer.current = window.setTimeout(onCreated, 500)
    } catch (saveError) {
      setSubmitError(
        saveError instanceof Error
          ? saveError.message
          : 'The file could not be created. Your entries are still here; try again.',
      )
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="main-content">
      <section className="page-heading page-heading--compact">
        <button className="back-link" type="button" onClick={onCancel}>
          <span aria-hidden="true">←</span> Home
        </button>
        <p className="eyebrow">ORGANIZE YOUR LEARNING</p>
        <h1>Create New File</h1>
        <p className="page-description">
          A file is a container for notes. Choose where it belongs in your
          taxonomy.
        </p>
      </section>

      <form className="panel create-form" onSubmit={submit} noValidate>
        {loadError ? (
          <div className="notice notice--error" role="alert">
            {loadError}{' '}
            <button className="text-button" type="button" onClick={refresh}>
              Try again
            </button>
          </div>
        ) : null}
        {data && data.categories.length === 0 && !loading ? (
          <p className="notice notice--info" role="status">
            No categories are available yet. Set up real taxonomy records
            before creating a file.
          </p>
        ) : null}
        <label className="field" htmlFor="create-file-name">
          <span>File Name</span>
          <input
            id="create-file-name"
            type="text"
            value={name}
            maxLength={120}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            aria-invalid={Boolean(validationMessage && !name.trim())}
          />
          <span className="field-hint">Up to 120 characters.</span>
        </label>
        <TaxonomySelectors
          prefix="create"
          categories={data?.categories ?? []}
          topics={data?.topics ?? []}
          subtopics={data?.subtopics ?? []}
          categoryId={categoryId}
          topicId={topicId}
          subtopicId={subtopicId}
          loading={loading || !data}
          onCategoryChange={(value) => {
            setCategoryId(value)
            setTopicId('')
            setSubtopicId('')
          }}
          onTopicChange={(value) => {
            setTopicId(value)
            setSubtopicId('')
          }}
          onSubtopicChange={setSubtopicId}
        />
        {validationMessage || submitError ? (
          <div
            className="notice notice--error"
            role="alert"
            aria-live="assertive"
          >
            {validationMessage || submitError}
          </div>
        ) : null}
        {created ? (
          <div className="notice notice--success save-success" role="status">
            File created. Returning to Home…
          </div>
        ) : null}
        <div className="form-actions">
          <button
            className="button button--quiet"
            type="button"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            type="submit"
            disabled={submitting || loading || !data || created}
          >
            {submitting ? 'Creating file…' : 'Create File'}
          </button>
        </div>
      </form>
    </main>
  )
}

function App() {
  const client = getSupabaseClient()
  const { route, navigate } = useRoute()
  const {
    session,
    updateSession,
    loading,
    error,
    setError,
    recoveryMode,
    setRecoveryMode,
  } = useSession(client)
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    if (!client) {
      return
    }
    setSigningOut(true)
    setError('')
    try {
      const { error: signOutError } = await client.auth.signOut()
      if (signOutError) {
        setError('Sign out failed. Check your connection and try again.')
      } else {
        updateSession(null)
        navigate('/')
      }
    } catch {
      setError('Sign out failed. Check your connection and try again.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="app-shell">
      <BrandHeader
        email={session?.user.email ?? undefined}
        onSignOut={() => void signOut()}
        signingOut={signingOut}
      />
      {loading ? (
        <main className="loading-page" role="status" aria-live="polite">
          Restoring your session…
        </main>
      ) : !client ? (
        <main className="auth-page">
          <div className="notice notice--error" role="alert">
            {supabaseConfiguration.message}
          </div>
        </main>
      ) : !session ? (
        <AuthPanel
          client={client}
          restoredSessionError={
            route.path === '/reset-password'
              ? passwordRecoveryLinkError(route.search, window.location.hash) ??
                'The recovery link did not establish a session. Request a new password recovery email.'
              : error
          }
          onAuthenticated={updateSession}
        />
      ) : route.path === '/reset-password' ? (
        recoveryMode ? (
          <RecoveryPasswordPanel
            client={client}
            hasRecoverySession={recoveryMode && session !== null}
            onComplete={async () => {
              const { error: signOutError } = await client.auth.signOut({
                scope: 'local',
              })
              if (signOutError) return false
              setRecoveryMode(false)
              updateSession(null)
              navigate('/')
              return true
            }}
          />
        ) : (
          <main className="auth-page">
            <section className="auth-card">
              <div className="notice notice--warning" role="alert">
                This page requires a valid password recovery link. Request a
                new link from the sign-in screen if the email link has expired.
              </div>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => navigate('/')}
              >
                Return to sign in
              </button>
            </section>
          </main>
        )
      ) : (
        <>
          {error ? (
            <div className="session-notice notice notice--error" role="alert">
              {error}
            </div>
          ) : null}
          {route.path === '/create-file' ? (
            <CreateFilePage
              key="create-file"
              client={client}
              onCancel={() => navigate('/')}
              onCreated={() => navigate('/')}
            />
          ) : route.path === '/notes' ? (
            <NotesWorkspace
              client={client}
              session={session}
              search={route.search}
              navigate={navigate}
            />
          ) : (
            <HomePage key="home" client={client} navigate={navigate} />
          )}
        </>
      )}
      <SiteFooter />
    </div>
  )
}

export default App
