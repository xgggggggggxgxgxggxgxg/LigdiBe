# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# LigdiBe : modules natifs appelés par réflexion depuis React Native
-keep class com.ligdibe.sms.** { *; }
-keep class com.op.sqlite.** { *; }
-keep class io.invertase.notifee.** { *; }
