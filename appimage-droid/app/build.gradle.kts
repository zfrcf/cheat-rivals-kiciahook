plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.appimagedroid"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.appimagedroid"
        minSdk = 29          // Android 10
        // 29 : garde l'accès « legacy » à /sdcard sur Android 10 (partagé avec Termux).
        targetSdk = 29
        versionCode = 4
        versionName = "1.0.3"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signé avec la clé de debug pour pouvoir installer l'APK directement.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = false; checkReleaseBuilds = false }
}

dependencies {
    implementation("org.tukaani:xz:1.10")
    implementation("com.github.luben:zstd-jni:1.5.6-8@aar")
    testImplementation("junit:junit:4.13.2")
}
