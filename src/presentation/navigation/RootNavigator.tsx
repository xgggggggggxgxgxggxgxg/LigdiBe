import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Icon, Text, useTheme } from 'react-native-paper';
import { DashboardScreen } from '../screens/DashboardScreen';
import { DataTrackerScreen } from '../screens/DataTrackerScreen';
import { DebtsScreen } from '../screens/DebtsScreen';
import { LockScreen } from '../screens/LockScreen';
import { ForecastScreen } from '../screens/ForecastScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { useFinanceStore } from '../store/useFinanceStore';
import { useLockStore } from '../store/useLockStore';
import { palette } from '../theme/theme';

export type RootTabParamList = {
  Accueil: undefined;
  Prévisionnel: undefined;
  Carnet: undefined;
  Stats: undefined;
  Réglages: undefined;
};

export type RootStackParamList = {
  Onglets: undefined;
  DataTracker: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const ICONS: Record<keyof RootTabParamList, string> = {
  Accueil: 'home-variant',
  Prévisionnel: 'clipboard-check-outline',
  Carnet: 'notebook-outline',
  Stats: 'chart-donut',
  Réglages: 'cog-outline',
};

const Tabs = () => {
  const theme = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarIcon: ({ color, size }) => <Icon source={ICONS[route.name]} color={color} size={size} />,
      })}>
      <Tab.Screen name="Accueil" component={DashboardScreen} />
      <Tab.Screen name="Prévisionnel" component={ForecastScreen} />
      <Tab.Screen name="Carnet" component={DebtsScreen} />
      <Tab.Screen name="Stats" component={StatsScreen} />
      <Tab.Screen name="Réglages" component={SettingsScreen} />
    </Tab.Navigator>
  );
};

export const RootNavigator = () => {
  const ready = useFinanceStore(s => s.ready);
  const onboarded = useFinanceStore(s => s.onboarded);
  const error = useFinanceStore(s => s.error);
  const locked = useLockStore(s => s.locked);
  const theme = useTheme();

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={palette.green} size="large" />
      </View>
    );
  }
  if (locked) {
    return <LockScreen />;
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text>Impossible d'ouvrir la base chiffrée : {error}</Text>
      </View>
    );
  }
  if (!onboarded) {
    return <OnboardingScreen />;
  }
  return (
    <NavigationContainer
      theme={{
        ...(theme.dark ? DarkTheme : DefaultTheme),
        colors: {
          ...(theme.dark ? DarkTheme : DefaultTheme).colors,
          primary: theme.colors.primary,
          background: theme.colors.background,
          card: theme.colors.surface,
          text: theme.colors.onSurface,
        },
      }}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Onglets" component={Tabs} />
        <Stack.Screen name="DataTracker" component={DataTrackerScreen} options={{ animation: 'slide_from_right' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
