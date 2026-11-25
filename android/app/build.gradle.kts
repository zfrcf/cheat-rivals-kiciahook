plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.phonepilot"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.phonepilot"
        minSdk = 29
        // targetSdk 29 imposé : stockage « legacy » (requestLegacyExternalStorage) et règles Android 10.
        targetSdk = 29
        versionCode = 1
        versionName = "0.1.0"
    }

    // Clé de signature stable fournie par la CI (secret GitHub ANDROID_KEYSTORE_B64) : jamais dans le dépôt.
    val ks = System.getenv("PP_KEYSTORE")
    signingConfigs {
        if (ks != null) create("stable") {
            storeFile = file(ks)
            storePassword = System.getenv("PP_KEYSTORE_PASSWORD") ?: "phonepilot"
            keyAlias = "phonepilot"
            keyPassword = System.getenv("PP_KEYSTORE_PASSWORD") ?: "phonepilot"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (ks != null) signingConfigs.getByName("stable") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint {
        // targetSdk 29 volontaire (sideload, pas de Play Store).
        disable += setOf("ExpiredTargetSdkVersion", "OldTargetApi", "ProtectedPermissions", "QueryAllPackagesPermission")
        abortOnError = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("dev.rikka.shizuku:api:13.1.5")
    implementation("dev.rikka.shizuku:provider:13.1.5")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
