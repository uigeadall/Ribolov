import React, { Component, ReactNode } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { lightColorsLegacy } from '../theme/palette';
import { spacing, typography } from '../theme/typography';
import { captureException } from '../services/observability';

type Props = { children: ReactNode; label?: string };

type State = { error: Error | null; info: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    this.setState({ info: info.componentStack ?? null });
    captureException(error, {
      area: 'react_error_boundary',
      screen: this.props.label ?? 'unknown',
    });
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.wrap}>
          <Text style={styles.title}>Грешка в екрана{this.props.label ? ` „${this.props.label}"` : ''}</Text>
          <Text style={styles.msg}>{this.state.error.message || String(this.state.error)}</Text>
          <ScrollView style={styles.stackBox} contentContainerStyle={{ padding: spacing.md }}>
            <Text style={styles.stack}>{this.state.error.stack}</Text>
            {this.state.info ? <Text style={styles.stack}>{this.state.info}</Text> : null}
          </ScrollView>
        </View>
      );
    }
    return this.props.children as any;
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: lightColorsLegacy.background, padding: spacing.lg },
  title: { ...typography.h2, color: lightColorsLegacy.danger, marginTop: spacing.xl },
  msg: { ...typography.body, color: lightColorsLegacy.text, marginTop: spacing.md },
  stackBox: {
    flex: 1,
    backgroundColor: '#0E2230',
    borderRadius: 8,
    marginTop: spacing.lg,
  },
  stack: { color: '#9DD0E0', fontFamily: 'Courier', fontSize: 11, lineHeight: 16 },
});
