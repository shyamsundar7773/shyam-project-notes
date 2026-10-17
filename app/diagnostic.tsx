import { Link } from 'expo-router'
import { Platform, StyleSheet, Text, View } from 'react-native'

export default function ExpoDiagnostics() {
  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>Foundation checks</Text>
        <Text style={styles.row}>Runtime platform: {Platform.OS}</Text>
        <Text style={styles.row}>Router: Expo Router file-based route</Text>
        <Text style={styles.row}>Native modules: none beyond Expo Go</Text>
        <Text style={styles.note}>
          This route is retained for platform checks. Authentication and the
          initial cloud-file shell are available from the main app routes.
        </Text>
        <Link href="/" style={styles.link}>
          Back to foundation screen
        </Link>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#e8e1ec',
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    maxWidth: 560,
    padding: 28,
    width: '100%',
  },
  title: {
    color: '#30283d',
    fontSize: 26,
    fontWeight: '700',
  },
  row: {
    color: '#443b50',
    fontSize: 16,
  },
  note: {
    color: '#6f6576',
    fontSize: 14,
    lineHeight: 21,
  },
  link: {
    alignSelf: 'flex-start',
    color: '#69448a',
    fontSize: 16,
    fontWeight: '700',
    paddingVertical: 8,
  },
})
