import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  NavigationContainer,
  DefaultTheme,
  useNavigationContainerRef,
  type LinkingOptions,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PlatformPressable } from '@react-navigation/elements';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import {
  FeedStackParamList,
  LogbookStackParamList,
  ProfileStackParamList,
  RootStackParamList,
  SpeciesStackParamList,
  TabsParamList,
} from './types';
import { useNotificationNavigation } from '../hooks/useNotificationNavigation';
import { useUnreadNotifCount } from '../hooks/useUnreadNotifCount';
import { useAuth } from '../services/authContext';
import AsyncStorage from '../storage/kv';
import * as Location from 'expo-location';
import { catchesStore } from '../storage/storage';

import HomeScreen from '../screens/HomeScreen';
import LogbookScreen from '../screens/LogbookScreen';
import AddCatchScreen from '../screens/AddCatchScreen';
import CatchDetailScreen from '../screens/CatchDetailScreen';
import MapScreen from '../screens/MapScreen';
import SpeciesScreen from '../screens/SpeciesScreen';
import SpeciesDetailScreen from '../screens/SpeciesDetailScreen';
import RegulationsScreen from '../screens/RegulationsScreen';
import GearScreen from '../screens/GearScreen';
import ProfileScreen from '../screens/ProfileScreen';
import StatsScreen from '../screens/StatsScreen';
import AuthScreen from '../screens/AuthScreen';
import FeedScreen from '../screens/FeedScreen';
import FriendsScreen from '../screens/FriendsScreen';
import TournamentsScreen from '../screens/TournamentsScreen';
import TournamentDetailScreen from '../screens/TournamentDetailScreen';
import CreateTournamentScreen from '../screens/CreateTournamentScreen';
import AchievementsScreen from '../screens/AchievementsScreen';
import KnotsScreen from '../screens/KnotsScreen';
import KnotDetailScreen from '../screens/KnotDetailScreen';
import WeightCalcScreen from '../screens/WeightCalcScreen';
import TripsScreen from '../screens/TripsScreen';
import TripDetailScreen from '../screens/TripDetailScreen';
import InsightsScreen from '../screens/InsightsScreen';
import ClassicsScreen from '../screens/ClassicsScreen';
import ChatsScreen from '../screens/ChatsScreen';
import ChatDetailScreen from '../screens/ChatDetailScreen';
import LegalInfoScreen from '../screens/LegalInfoScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import UserPublicProfileScreen from '../screens/UserPublicProfileScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import SavedPostsScreen from '../screens/SavedPostsScreen';
import { ErrorBoundary } from '../components/ErrorBoundary';
import SearchScreen from '../screens/SearchScreen';
import PersonalBestsScreen from '../screens/PersonalBestsScreen';
import GroupsScreen from '../screens/GroupsScreen';
import GroupDetailScreen from '../screens/GroupDetailScreen';
import CreateGroupScreen from '../screens/CreateGroupScreen';
import CreateGroupEventScreen from '../screens/CreateGroupEventScreen';
import CreateGroupPollScreen from '../screens/CreateGroupPollScreen';
import ExploreScreen from '../screens/ExploreScreen';
import CreatePostScreen from '../screens/CreatePostScreen';
import HashtagFeedScreen from '../screens/HashtagFeedScreen';
import SpeciesTargetScreen from '../screens/SpeciesTargetScreen';
import PhotoGalleryScreen from '../screens/PhotoGalleryScreen';
import TripPlannerScreen from '../screens/TripPlannerScreen';
import NotificationPreferencesScreen from '../screens/NotificationPreferencesScreen';

const wrap = (label: string, Component: React.ComponentType<any>) => (props: any) =>
  (
    <ErrorBoundary label={label}>
      <Component {...props} />
    </ErrorBoundary>
  );

const HomeScreenWrapped = wrap('Начало', HomeScreen);
const MapScreenWrapped = wrap('Карта', MapScreen);
const AuthScreenWrapped = wrap('Вход', AuthScreen);
const FeedScreenWrapped = wrap('Feed', FeedScreen);
const FriendsScreenWrapped = wrap('Приятели', FriendsScreen);
const LeaderboardScreenWrapped = wrap('Класирания', LeaderboardScreen);
const ClassicsScreenWrapped = wrap('Класики', ClassicsScreen);
const UserPublicProfileWrapped = wrap('Профил на рибар', UserPublicProfileScreen);
const NotificationsWrapped = wrap('Известия', NotificationsScreen);
const SavedPostsWrapped = wrap('Запазени', SavedPostsScreen);

const Tabs = createBottomTabNavigator<TabsParamList>();
const LogbookStack = createNativeStackNavigator<LogbookStackParamList>();
const FeedStack = createNativeStackNavigator<FeedStackParamList>();
const SpeciesStack = createNativeStackNavigator<SpeciesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

function LogbookNavigator() {
  return (
    <ErrorBoundary label="Дневник">
      <LogbookStack.Navigator screenOptions={{ headerShown: false }}>
        <LogbookStack.Screen name="LogbookList" component={LogbookScreen} />
        <LogbookStack.Screen name="AddCatch" component={AddCatchScreen} />
        <LogbookStack.Screen name="CatchDetail" component={CatchDetailScreen} />
        <LogbookStack.Screen name="PhotoGallery" component={PhotoGalleryScreen} />
      </LogbookStack.Navigator>
    </ErrorBoundary>
  );
}

function SpeciesNavigator() {
  return (
    <ErrorBoundary label="Видове">
      <SpeciesStack.Navigator screenOptions={{ headerShown: false }}>
        <SpeciesStack.Screen name="SpeciesList" component={SpeciesScreen} />
        <SpeciesStack.Screen name="SpeciesDetail" component={SpeciesDetailScreen} />
        <SpeciesStack.Screen name="SpeciesTarget" component={SpeciesTargetScreen} />
        <SpeciesStack.Screen name="Regulations" component={RegulationsScreen} />
        <SpeciesStack.Screen name="Gear" component={GearScreen} />
        <SpeciesStack.Screen name="Knots" component={KnotsScreen} />
        <SpeciesStack.Screen name="KnotDetail" component={KnotDetailScreen} />
        <SpeciesStack.Screen name="WeightCalc" component={WeightCalcScreen} />
      </SpeciesStack.Navigator>
    </ErrorBoundary>
  );
}

function FeedNavigator() {
  return (
    <FeedStack.Navigator screenOptions={{ headerShown: false }}>
      <FeedStack.Screen name="FeedList" component={FeedScreenWrapped} />
      <FeedStack.Screen name="CatchDetail" component={CatchDetailScreen} />
      <FeedStack.Screen name="Classics" component={ClassicsScreenWrapped} />
      <FeedStack.Screen name="SavedPosts" component={SavedPostsWrapped} />
      <FeedStack.Screen name="Notifications" component={NotificationsWrapped} />
      <FeedStack.Screen name="Auth" component={AuthScreenWrapped} />
      <FeedStack.Screen name="Friends" component={FriendsScreenWrapped} />
      <FeedStack.Screen name="Explore" component={ExploreScreen} />
      <FeedStack.Screen name="CreatePost" component={CreatePostScreen} />
      <FeedStack.Screen name="HashtagFeed" component={HashtagFeedScreen} />
    </FeedStack.Navigator>
  );
}

function ProfileNavigator() {
  return (
    <ErrorBoundary label="Профил">
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} />
      <ProfileStack.Screen name="CatchDetail" component={CatchDetailScreen} />
      <ProfileStack.Screen name="Notifications" component={NotificationsWrapped} />
      <ProfileStack.Screen name="Stats" component={StatsScreen} />
      <ProfileStack.Screen name="Auth" component={AuthScreenWrapped} />
      <ProfileStack.Screen name="Feed" component={FeedScreenWrapped} />
      <ProfileStack.Screen name="SavedPosts" component={SavedPostsWrapped} />
      <ProfileStack.Screen name="Friends" component={FriendsScreenWrapped} />
      <ProfileStack.Screen name="Tournaments" component={TournamentsScreen} />
      <ProfileStack.Screen name="TournamentDetail" component={TournamentDetailScreen} />
      <ProfileStack.Screen name="CreateTournament" component={CreateTournamentScreen} />
      <ProfileStack.Screen name="Achievements" component={AchievementsScreen} />
      <ProfileStack.Screen name="Trips" component={TripsScreen} />
      <ProfileStack.Screen name="TripDetail" component={TripDetailScreen} />
      <ProfileStack.Screen name="TripPlanner" component={TripPlannerScreen} />
      <ProfileStack.Screen name="Insights" component={InsightsScreen} />
      <ProfileStack.Screen name="Leaderboard" component={LeaderboardScreenWrapped} />
      <ProfileStack.Screen name="Classics" component={ClassicsScreenWrapped} />
      <ProfileStack.Screen name="Chats" component={ChatsScreen} />
      <ProfileStack.Screen name="ChatDetail" component={ChatDetailScreen} />
      <ProfileStack.Screen name="LegalInfo" component={LegalInfoScreen} />
      <ProfileStack.Screen name="Species" component={SpeciesNavigator} />
      <ProfileStack.Screen name="PersonalBests" component={PersonalBestsScreen} />
      <ProfileStack.Screen name="Groups" component={GroupsScreen} />
      <ProfileStack.Screen name="GroupDetail" component={GroupDetailScreen} />
      <ProfileStack.Screen name="CreateGroup" component={CreateGroupScreen} />
      <ProfileStack.Screen name="CreateGroupEvent" component={CreateGroupEventScreen} />
      <ProfileStack.Screen name="CreateGroupPoll" component={CreateGroupPollScreen} />
      <ProfileStack.Screen name="NotificationPreferences" component={NotificationPreferencesScreen} />
    </ProfileStack.Navigator>
    </ErrorBoundary>
  );
}

function TabNavigator() {
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const unreadNotifs = useUnreadNotifCount(user?.uid);
  const [feedBadge, setFeedBadge] = React.useState<string | undefined>(undefined);
  const [mapBadge, setMapBadge] = React.useState<string | undefined>(undefined);

  // Track the highest nearby-count the user has already seen, so we only badge
  // when there are NEW nearby catches — not on every cold start with the same
  // count (which read as a misleading "unread" indicator).
  const nearbyCountRef = React.useRef<number>(0);
  React.useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const catches = await catchesStore.list();
        const nearby = catches.filter((c) => {
          if (!c.location?.latitude || !c.location?.longitude) return false;
          const dlat = c.location.latitude - loc.coords.latitude;
          const dlng = c.location.longitude - loc.coords.longitude;
          const dist = Math.sqrt(dlat * dlat + dlng * dlng) * 111;
          return dist < 50;
        });
        const currentCount = nearby.length;
        nearbyCountRef.current = currentCount;
        if (currentCount === 0) return;
        const lastSeen = parseInt(
          (await AsyncStorage.getItem('@ribolov/nearbyBadgeSeen')) ?? '0',
          10,
        );
        // Only badge if more nearby catches than last time the user looked.
        // The badge then shows just the delta — e.g. "2" means two new ones.
        const delta = currentCount - lastSeen;
        if (delta > 0) setMapBadge(String(delta));
      } catch {}
    })();
  }, []);

  React.useEffect(() => {
    AsyncStorage.getItem('@ribolov/feedLastVisit')
      .then((v) => {
        if (!v || Date.now() - parseInt(v, 10) > 30 * 60 * 1000) {
          setFeedBadge('·');
        }
      })
      .catch(() => {});
  }, []);
  // Bubble tab bar: floats above safe area as a pill

  // Animated icon that scales up + bounces on focus change. Lives inside the
  // component so it captures the right Animated.Value lifecycle per tab.
  // The spring runs whenever `focused` flips so a tab tap feels tactile —
  // tap into a tab and the icon "pops" instead of jump-cutting. Color tween
  // is driven by react-navigation's `color` prop (no extra animation).
  function AnimatedTabIcon({
    focused,
    color,
    icon,
  }: {
    focused: boolean;
    color: string;
    icon: keyof typeof Ionicons.glyphMap;
  }) {
    const scale = useRef(new Animated.Value(focused ? 1 : 0.92)).current;
    const prevFocused = useRef(focused);
    useEffect(() => {
      // Spring animation gives the icon a tiny overshoot when activating —
      // bouncier than a plain timing curve. On deactivation we just settle
      // back to neutral with no overshoot.
      Animated.spring(scale, {
        toValue: focused ? 1.08 : 0.92,
        useNativeDriver: true,
        speed: 30,
        bounciness: focused ? 14 : 0,
      }).start();
      // Light haptic on activation. Skipped on first mount (when
      // prevFocused.current matches focused). Without this guard the user
      // gets a buzz every app launch.
      if (prevFocused.current !== focused && focused) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      prevFocused.current = focused;
    }, [focused, scale]);
    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons name={icon} size={22} color={color} />
      </Animated.View>
    );
  }

  const bubbleTabBarStyle = useMemo(
    () => ({
      marginHorizontal: 12,
      marginBottom: Math.max(insets.bottom + 6, 12),
      height: 58,
      borderRadius: 32,
      backgroundColor: 'transparent',
      borderTopWidth: 0,
      elevation: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: mode === 'dark' ? 0.45 : 0.10,
      shadowRadius: 20,
      paddingTop: 0,
      paddingBottom: 0,
    }),
    [mode, insets.bottom]
  );

  const tabBarBackground = useMemo(
    () => () => (
      <View style={[StyleSheet.absoluteFillObject, {
        borderRadius: 36,
        backgroundColor: mode === 'dark' ? '#0C1C30' : '#FFFFFF',
        borderWidth: 1,
        borderColor: mode === 'dark' ? 'rgba(74,168,232,0.22)' : 'rgba(21,112,184,0.1)',
        overflow: 'hidden',
      }]} />
    ),
    [mode]
  );

  return (
    <Tabs.Navigator
      safeAreaInsets={{ bottom: 0 }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: mode === 'dark' ? '#3A6080' : '#AAC8E0',
        tabBarStyle: bubbleTabBarStyle,
        tabBarBackground,
        tabBarShowLabel: false,
        tabBarButton: (props) => {
          const focused = !!props.accessibilityState?.selected;
          const label =
            route.name === 'HomeTab' ? 'Начало' :
            route.name === 'LogbookTab' ? 'Дневник' :
            route.name === 'MapTab' ? 'Карта' :
            route.name === 'FeedTab' ? 'Лента' : 'Профил';
          return (
            <PlatformPressable
              {...props}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              <View style={{
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: focused ? 14 : 8,
                paddingVertical: focused ? 5 : 8,
                borderRadius: 20,
                gap: 2,
                backgroundColor: focused
                  ? (mode === 'dark' ? 'rgba(43,135,206,0.22)' : 'rgba(21,112,184,0.11)')
                  : 'transparent',
              }}>
                {props.children}
                {focused && (
                  <Text style={{
                    fontSize: 10,
                    fontFamily: 'Nunito_700Bold',
                    color: colors.primary,
                    lineHeight: 11,
                  }}>
                    {label}
                  </Text>
                )}
              </View>
            </PlatformPressable>
          );
        },
        tabBarIcon: ({ color, focused }) => {
          let icon: keyof typeof Ionicons.glyphMap = 'home';
          if (route.name === 'HomeTab') icon = focused ? 'home' : 'home-outline';
          if (route.name === 'LogbookTab') icon = focused ? 'book' : 'book-outline';
          if (route.name === 'MapTab') icon = focused ? 'map' : 'map-outline';
          if (route.name === 'FeedTab') icon = focused ? 'newspaper' : 'newspaper-outline';
          if (route.name === 'ProfileTab') icon = focused ? 'person' : 'person-outline';
          return <AnimatedTabIcon focused={focused} color={color} icon={icon} />;
        },
      })}
    >
      <Tabs.Screen name="HomeTab" component={HomeScreenWrapped} options={{ title: 'Начало' }} />
      <Tabs.Screen
        name="LogbookTab"
        component={LogbookNavigator}
        options={{ title: 'Дневник' }}
        listeners={({ navigation }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate('LogbookTab', { screen: 'LogbookList' }); },
        })}
      />
      <Tabs.Screen
        name="MapTab"
        component={MapScreenWrapped}
        options={{ title: 'Карта', tabBarBadge: mapBadge }}
        listeners={() => ({
          tabPress: () => {
            setMapBadge(undefined);
            // Persist the dismissal so we don't re-badge on next cold start
            // unless the user adds MORE nearby catches.
            AsyncStorage.setItem(
              '@ribolov/nearbyBadgeSeen',
              String(nearbyCountRef.current),
            ).catch(() => {});
          },
        })}
      />
      <Tabs.Screen
        name="FeedTab"
        component={FeedNavigator}
        options={{ title: 'Лента', tabBarBadge: feedBadge }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            setFeedBadge(undefined);
            AsyncStorage.setItem('@ribolov/feedLastVisit', String(Date.now())).catch(() => {});
            navigation.navigate('FeedTab', { screen: 'FeedList' });
          },
        })}
      />
      <Tabs.Screen
        name="ProfileTab"
        component={ProfileNavigator}
        options={{ title: 'Профил', tabBarBadge: unreadNotifs > 0 ? unreadNotifs : undefined }}
        listeners={({ navigation }) => ({
          tabPress: (e) => { e.preventDefault(); navigation.navigate('ProfileTab', { screen: 'ProfileMain' }); },
        })}
      />
    </Tabs.Navigator>
  );
}

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['ribolov-app://'],
  config: {
    screens: {
      Main: {
        screens: {
          ProfileTab: {
            screens: {
              Notifications: 'notifications',
            },
          },
        },
      },
      UserPublicProfile: 'user/:uid',
    },
  },
};

export function RootNavigator() {
  const { colors, mode } = useTheme();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [navReady, setNavReady] = useState(false);

  useNotificationNavigation(navigationRef, navReady);

  const navTheme = useMemo(
    () => ({
      ...DefaultTheme,
      dark: mode === 'dark',
      colors: {
        ...DefaultTheme.colors,
        background: colors.background,
        card: colors.card,
        text: colors.text,
        border: colors.border,
        primary: colors.primary,
      },
    }),
    [colors, mode]
  );

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      linking={linking}
      onReady={() => setNavReady(true)}
    >
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        <RootStack.Screen name="Main" component={TabNavigator} />
        <RootStack.Screen name="UserPublicProfile" component={UserPublicProfileWrapped} />
        <RootStack.Screen
          name="Search"
          component={SearchScreen}
          options={{ presentation: 'modal' }}
        />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
