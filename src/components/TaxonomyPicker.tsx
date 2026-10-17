import { useRef, useState } from 'react'
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import {
  subtopicsForTopic,
  selectCategory,
  selectTopic,
  topicsForCategory,
  inlineRenameActionForKey,
  isDoubleActivation,
  taxonomyDeleteWarning,
  validateTaxonomyName,
  type TaxonomyRecord,
  type TaxonomySelection,
  type TaxonomyTable,
  type WorkspaceData,
} from '../lib/phase1'
import { screenStyles } from './expo-screen-styles'
import { useAppTheme, type ThemeColors } from './ThemeContext'

type Props = {
  data: WorkspaceData
  selection: TaxonomySelection
  onChange: (selection: TaxonomySelection) => void
  onRename?: (
    table: TaxonomyTable,
    record: TaxonomyRecord,
    name: string,
  ) => Promise<boolean>
  onDelete?: (table: TaxonomyTable, record: TaxonomyRecord) => Promise<boolean>
  onCreate?: (table: TaxonomyTable, name: string) => Promise<boolean>
}

const tableLabels: Record<TaxonomyTable, string> = {
  categories: 'Category',
  topics: 'Topic',
  subtopics: 'Subtopic',
}

export function TaxonomyPicker({
  data,
  selection,
  onChange,
  onRename,
  onDelete,
  onCreate,
}: Props) {
  const { colors } = useAppTheme()
  const [openLevel, setOpenLevel] = useState<TaxonomyTable | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{
    table: TaxonomyTable
    record: TaxonomyRecord
  } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [pendingCreate, setPendingCreate] = useState<TaxonomyTable | null>(null)
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  const topics = topicsForCategory(data, selection.categoryId)
  const subtopics = subtopicsForTopic(
    data,
    selection.categoryId,
    selection.topicId,
  )

  async function confirmDelete() {
    if (!pendingDelete || !onDelete || deleteBusy) return
    setDeleteBusy(true)
    try {
      if (await onDelete(pendingDelete.table, pendingDelete.record)) {
        setPendingDelete(null)
      }
    } finally {
      setDeleteBusy(false)
    }
  }

  async function confirmCreate() {
    if (!pendingCreate || !onCreate || createBusy) return
    const validationError = validateTaxonomyName(createName)
    if (validationError) {
      setCreateError(validationError)
      return
    }
    setCreateBusy(true)
    setCreateError('')
    try {
      if (await onCreate(pendingCreate, createName)) {
        setPendingCreate(null)
        setCreateName('')
      }
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : 'The item could not be created.',
      )
    } finally {
      setCreateBusy(false)
    }
  }

  function renderItems<T extends TaxonomyRecord>(
    table: TaxonomyTable,
    items: T[],
    selectedId: string,
    onSelect: (id: string) => void,
    emptyMessage: string,
  ) {
    if (items.length === 0) {
      return <Text style={[styles.empty, { color: colors.mutedText }]}>{emptyMessage}</Text>
    }
    return (
      <View style={styles.items}>
        {items.map((record) => {
          const isSelected = selectedId === record.id
          return (
            <TaxonomyRow
              key={record.id}
              isSelected={isSelected}
              onDelete={onDelete ? () => setPendingDelete({ table, record }) : undefined}
              onRename={
                onRename
                  ? (name) => onRename(table, record, name)
                  : undefined
              }
              onSelect={() => onSelect(record.id)}
              record={record}
              table={table}
            />
          )
        })}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.level}>
        <View style={styles.levelHeader}>
          <Text accessibilityRole="header" style={[styles.levelTitle, { color: colors.text }]}>Category{onRename ? '' : ' *'}</Text>
          {onCreate ? <CreateButton label="Add Category" onPress={() => { setPendingCreate('categories'); setCreateName(''); setCreateError('') }} /> : null}
        </View>
        <SelectorButton
          label={data.categories.find((item) => item.id === selection.categoryId)?.name ?? 'Select a Category'}
          colors={colors}
          disabled={data.categories.length === 0}
          expanded={openLevel === 'categories'}
          onPress={() => setOpenLevel('categories')}
        />
      </View>
      <View style={styles.level}>
        <View style={styles.levelHeader}>
          <Text accessibilityRole="header" style={[styles.levelTitle, { color: colors.text }]}>Topic{onRename ? '' : ' *'}</Text>
          {onCreate && selection.categoryId ? <CreateButton label="Add Topic" onPress={() => { setPendingCreate('topics'); setCreateName(''); setCreateError('') }} /> : null}
        </View>
        {!selection.categoryId ? (
          <Text style={[styles.empty, { color: colors.mutedText }]}>Select a Category first.</Text>
        ) : (
          <SelectorButton
            label={topics.find((item) => item.id === selection.topicId)?.name ?? 'Select a Topic'}
            colors={colors}
            disabled={topics.length === 0}
            expanded={openLevel === 'topics'}
            onPress={() => setOpenLevel('topics')}
          />
        )}
      </View>
      <View style={styles.level}>
        <View style={styles.levelHeader}>
          <Text accessibilityRole="header" style={[styles.levelTitle, { color: colors.text }]}>Subtopic{onRename ? '' : ' *'}</Text>
          {onCreate && selection.topicId ? <CreateButton label="Add Subtopic" onPress={() => { setPendingCreate('subtopics'); setCreateName(''); setCreateError('') }} /> : null}
        </View>
        {!selection.topicId ? (
          <Text style={[styles.empty, { color: colors.mutedText }]}>Select a Topic first.</Text>
        ) : (
          <SelectorButton
            label={subtopics.find((item) => item.id === selection.subtopicId)?.name ?? 'Select a Subtopic'}
            colors={colors}
            disabled={subtopics.length === 0}
            expanded={openLevel === 'subtopics'}
            onPress={() => setOpenLevel('subtopics')}
          />
        )}
      </View>
      <Modal
        accessibilityViewIsModal
        animationType="fade"
        onRequestClose={() => setOpenLevel(null)}
        transparent
        visible={openLevel !== null}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.confirmCard, { backgroundColor: colors.surface }]}>
            <Text accessibilityRole="header" style={[styles.levelTitle, { color: colors.text }]}>
              Choose {openLevel ? tableLabels[openLevel] : 'item'}
            </Text>
            {openLevel === 'categories'
              ? renderItems('categories', data.categories, selection.categoryId, (categoryId) => {
                onChange(selectCategory(data, selection, categoryId))
                setOpenLevel(null)
              }, 'No categories are available for this account.')
              : openLevel === 'topics'
              ? renderItems('topics', topics, selection.topicId, (topicId) => {
                  onChange(selectTopic(data, selection, topicId))
                    setOpenLevel(null)
                  }, 'No Topics are available in this Category.')
                : openLevel === 'subtopics'
                  ? renderItems('subtopics', subtopics, selection.subtopicId, (subtopicId) => {
                      onChange({ ...selection, subtopicId })
                      setOpenLevel(null)
                    }, 'No Subtopics are available in this Topic.')
                  : null}
            <Pressable accessibilityRole="button" onPress={() => setOpenLevel(null)} style={screenStyles.secondaryButton}>
              <Text style={[screenStyles.secondaryText, { color: colors.accentText }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        accessibilityViewIsModal
        animationType="fade"
        onRequestClose={() => {
          if (!createBusy) setPendingCreate(null)
        }}
        transparent
        visible={pendingCreate !== null}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.confirmCard, { backgroundColor: colors.surface }]}>
            <Text accessibilityRole="header" style={[styles.levelTitle, { color: colors.text }]}>
              Add {pendingCreate ? tableLabels[pendingCreate] : 'item'}
            </Text>
            <TextInput
              accessibilityLabel={`${pendingCreate ? tableLabels[pendingCreate] : 'Item'} name`}
              autoCapitalize="words"
              maxLength={120}
              onChangeText={(text) => { setCreateName(text); setCreateError('') }}
              placeholder={`${pendingCreate ? tableLabels[pendingCreate] : 'Item'} name`}
              style={[screenStyles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
              value={createName}
            />
            {createError ? <Text accessibilityRole="alert" style={styles.inlineError}>{createError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={createBusy}
                onPress={() => setPendingCreate(null)}
                style={screenStyles.secondaryButton}
              >
                <Text style={screenStyles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: createBusy }}
                disabled={createBusy}
                onPress={() => void confirmCreate()}
                style={[screenStyles.button, createBusy && screenStyles.buttonDisabled]}
              >
                <Text style={screenStyles.buttonText}>{createBusy ? 'Saving…' : 'Create'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        accessibilityViewIsModal
        animationType="fade"
        onRequestClose={() => {
          if (!deleteBusy) setPendingDelete(null)
        }}
        transparent
        visible={pendingDelete !== null}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.confirmCard, { backgroundColor: colors.surface }]}>
          <Text accessibilityRole="header" style={[styles.levelTitle, { color: colors.text }]}>
              Delete {pendingDelete ? tableLabels[pendingDelete.table] : 'item'}?
            </Text>
            <Text style={[screenStyles.body, { color: colors.mutedText }]}>
              {pendingDelete
                ? taxonomyDeleteWarning(pendingDelete.table)
                : ''}
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={deleteBusy}
                onPress={() => setPendingDelete(null)}
                style={screenStyles.secondaryButton}
              >
                <Text style={screenStyles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: deleteBusy }}
                disabled={deleteBusy}
                onPress={() => void confirmDelete()}
                style={[screenStyles.button, deleteBusy && screenStyles.buttonDisabled]}
              >
                <Text style={screenStyles.buttonText}>
                  {deleteBusy
                    ? 'Deleting…'
                    : pendingDelete?.table === 'categories'
                      ? 'Delete Category + descendants'
                      : pendingDelete?.table === 'topics'
                        ? 'Delete Topic + descendants'
                        : 'Delete Subtopic'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function CreateButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useAppTheme()
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.createButton}>
      <Text style={[styles.createButtonText, { color: colors.accentText }]}>+ {label}</Text>
    </Pressable>
  )
}

function SelectorButton({
  label,
  colors,
  disabled,
  expanded,
  onPress,
}: {
  label: string
  colors: ThemeColors
  disabled: boolean
  expanded: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, expanded }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selector,
        { backgroundColor: colors.input, borderColor: colors.border },
        pressed && !disabled && styles.selectorPressed,
        disabled && screenStyles.buttonDisabled,
      ]}
    >
      <Text style={{ color: colors.text, flex: 1, fontSize: 15 }}>{label}</Text>
      <Text accessibilityElementsHidden style={{ color: colors.mutedText }}>⌄</Text>
    </Pressable>
  )
}

function TaxonomyRow({
  isSelected,
  onDelete,
  onRename,
  onSelect,
  record,
  table,
}: {
  isSelected: boolean
  onDelete?: () => void
  onRename?: (name: string) => Promise<boolean>
  onSelect: () => void
  record: TaxonomyRecord
  table: TaxonomyTable
}) {
  const { colors } = useAppTheme()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(record.name)
  const [error, setError] = useState('')
  const lastPress = useRef(0)
  const renameLock = useRef(false)
  const cancelOnBlur = useRef(false)

  async function saveRename() {
    if (!editing || !onRename || renameLock.current) return
    const validationError = validateTaxonomyName(name)
    if (validationError) {
      setError(validationError)
      return
    }
    renameLock.current = true
    setError('')
    try {
      if (await onRename(name)) setEditing(false)
    } finally {
      renameLock.current = false
    }
  }

  function cancelRename() {
    cancelOnBlur.current = true
    setName(record.name)
    setError('')
    setEditing(false)
  }

  return (
    <View style={[
      styles.item,
      { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
      isSelected && { backgroundColor: colors.infoBackground, borderColor: colors.accent },
    ]}>
      {editing ? (
        <View style={styles.inputColumn}>
          <TextInput
            accessibilityLabel={`Rename ${tableLabels[table]} ${record.name}`}
            autoFocus
            autoCapitalize="words"
            maxLength={120}
            onBlur={() => {
              if (cancelOnBlur.current) {
                cancelOnBlur.current = false
                return
              }
              void saveRename()
            }}
            onChangeText={(value) => {
              setName(value)
              setError('')
            }}
            onKeyPress={({ nativeEvent }) => {
              const action = inlineRenameActionForKey(nativeEvent.key)
              if (action === 'cancel') cancelRename()
              else if (action === 'save') void saveRename()
            }}
            onSubmitEditing={() => void saveRename()}
            returnKeyType="done"
            selectTextOnFocus
            style={[screenStyles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
            value={name}
          />
          {error ? (
            <Text accessibilityRole="alert"             style={[styles.inlineError, { color: colors.errorText }]}>
              {error}
            </Text>
          ) : null}
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: isSelected }}
          onPress={() => {
            const now = Date.now()
            if (isDoubleActivation(lastPress.current, now)) {
              if (onRename) {
                setName(record.name)
                setEditing(true)
              }
              lastPress.current = 0
            } else {
              lastPress.current = now
              onSelect()
            }
          }}
          style={styles.nameButton}
        >
          <Text style={[styles.itemName, { color: isSelected ? colors.accentText : colors.text }, isSelected && styles.selectedName]}>
            {record.name}
          </Text>
        </Pressable>
      )}
      {onRename && !editing ? (
        <Pressable
          accessibilityLabel={`Edit ${tableLabels[table]} ${record.name}`}
          accessibilityRole="button"
          onPress={() => {
            setName(record.name)
            setError('')
            setEditing(true)
          }}
          style={styles.actionButton}
        >
          <Text style={[styles.actionText, { color: colors.accentText }]}>Edit</Text>
        </Pressable>
      ) : null}
      {onDelete && !editing ? (
        <Pressable
          accessibilityLabel={`Delete ${tableLabels[table]} ${record.name}`}
          accessibilityRole="button"
          onPress={onDelete}
          style={styles.actionButton}
        >
          <Text style={[styles.deleteText, { color: colors.errorText }]}>Delete</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 18,
  },
  level: {
    borderTopColor: '#e8e1ec',
    borderTopWidth: 1,
    gap: 10,
    paddingTop: 14,
  },
  levelTitle: {
    color: '#30283d',
    fontSize: 17,
    fontWeight: '700',
  },
  selector: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  selectorPressed: {
    opacity: 0.8,
  },
  levelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  createButton: {
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 8,
  },
  createButtonText: {
    color: '#69448a',
    fontSize: 14,
    fontWeight: '700',
  },
  items: {
    gap: 8,
  },
  item: {
    alignItems: 'center',
    backgroundColor: '#faf9fb',
    borderColor: '#e8e1ec',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  itemSelected: {
    backgroundColor: '#f1edf5',
    borderColor: '#69448a',
  },
  nameButton: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingVertical: 8,
  },
  inputColumn: {
    flex: 1,
    gap: 4,
  },
  inlineError: {
    color: '#8b2424',
    fontSize: 12,
  },
  itemName: {
    color: '#443b50',
    fontSize: 15,
  },
  selectedName: {
    color: '#4f2e70',
    fontWeight: '700',
  },
  actionButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  actionText: {
    color: '#69448a',
    fontSize: 14,
    fontWeight: '700',
  },
  deleteText: {
    color: '#9a2929',
    fontSize: 14,
    fontWeight: '700',
  },
  empty: {
    color: '#6f6576',
    fontSize: 14,
    lineHeight: 20,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(25, 20, 30, 0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  confirmCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    gap: 16,
    maxWidth: 480,
    padding: 24,
    width: '100%',
  },
  modalActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'flex-end',
  },
})
