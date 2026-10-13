import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { DashboardScreen } from '../screens/DashboardScreen';
import { DebtsScreen } from '../screens/DebtsScreen';
import { ForecastScreen } from '../screens/ForecastScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { useFinanceStore } from '../store/useFinanceStore';
import { palette } from '../theme/theme';

export type RootTabParamList = {
  Accueil: undefined;
  Prévisionnel: undefined;
  Carnet: undefined;
  Stats: undefined;
  Réglages: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

const ICONS: Record<keyof RootTabParamList, string> = {
  Accueil: 'home-variant',
  Prévisionnel: 'clipboard-check-outline',
  Carnet: 'notebook-outline',
  Stats: 'chart-donut',
  Réglages: 'cog-outline',
};

export const RootNavigator = () => {
  const ready = useFinanceStore(s => s.ready);
  const onboarded = useFinanceStore(s => s.onboarded);
  const error = useFinanceStore(s => s.error);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={palette.green} size="large" />
      </View>
    );
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
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: palette.green,
          tabBarIcon: ({ color, size }) => <Icon source={ICONS[route.name]} color={color} size={size} />,
        })}>
        <Tab.Screen name="Accueil" component={DashboardScreen} />
        <Tab.Screen name="Prévisionnel" component={ForecastScreen} />
        <Tab.Screen name="Carnet" component={DebtsScreen} />
        <Tab.Screen name="Stats" component={StatsScreen} />
        <Tab.Screen name="Réglages" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
