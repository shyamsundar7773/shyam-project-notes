import { StyleSheet } from 'react-native'

export const screenStyles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e8e1ec',
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    maxWidth: 520,
    padding: 24,
    width: '100%',
  },
  eyebrow: {
    color: '#765b88',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  title: {
    color: '#30283d',
    fontSize: 28,
    fontWeight: '700',
  },
  body: {
    color: '#5b5363',
    fontSize: 16,
    lineHeight: 24,
  },
  fieldLabel: {
    color: '#30283d',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#cfc5d7',
    borderRadius: 10,
    borderWidth: 1,
    color: '#30283d',
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#69448a',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  secondaryText: {
    color: '#69448a',
    fontSize: 15,
    fontWeight: '700',
  },
  notice: {
    borderRadius: 8,
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
  },
  errorNotice: {
    backgroundColor: '#fff0ef',
    color: '#8b2424',
  },
  infoNotice: {
    backgroundColor: '#f1edf5',
    color: '#443b50',
  },
})
